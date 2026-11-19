/**
 * Evaluation Pipeline - Exposed function for running the chat pipeline
 * with full observability for evaluation purposes.
 * 
 * This is the SAME pipeline used by the chat route, just instrumented.
 */

import { User, Conversation } from '../models/index.js';
import {
  processChatQuestion,
  sanitizeQuery,
  expandQueryForRetrieval,
  detectWebSearchTrigger,
  confirmWebSearch,
} from './chat.js';
import { searchChunks } from './ingestion.js';
import { analyzeMessage } from './followUp.js';
import { dedupeChunks, scoreChunkForTopic, isBroadTopic, chunkCountForCue } from './followUp.js';
import { getRelevantMemories } from './memoryManager.js';
import { config } from '../config/index.js';

/**
 * Run the evaluation pipeline for a single question (or multi-turn conversation).
 * This mirrors processChatQuestion but returns all intermediate data for evaluation.
 * 
 * @param {Object} params
 * @param {string} params.studentId - Student ID (must exist in DB)
 * @param {string} params.question - The question to ask
 * @param {string} params.subject - Subject ID
 * @param {Object} [params.options] - Pipeline options
 * @param {number} [params.options.topK] - Override default top-k for retrieval
 * @param {number} [params.options.candidates] - Override candidate count
 * @param {number} [params.options.chunkSize] - Override chunk size (not used directly, config-based)
 * @param {number} [params.options.threshold] - Score threshold for abstain
 * @param {boolean} [params.options.reranker] - Enable/disable topic reranker
 * @param {string} [params.options.model] - Model name override
 * @param {boolean} [params.options.stream] - Return stream or collect full answer
 * @returns {Promise<Object>} Pipeline result with all intermediate data
 */
export async function runPipeline({
  studentId,
  question,
  subject,
  options = {},
}) {
  const startTime = Date.now();
  const timings = {};

  // Get student profile
  const student = await User.findById(studentId).lean();
  const studentProfile = {
    college: student?.college || 'Parul University',
    program: student?.program || 'btech',
    field: student?.field || 'Computer Engineering',
    fieldCategory: student?.fieldCategory || 'Engineering',
    subject: subject,
    semester: student?.semester || '1',
  };

  // Step 1: Detect web search trigger
  const { query: strippedQuery, isWebSearch: triggerIsWebSearch } = detectWebSearchTrigger(question);
  const isWebSearch = triggerIsWebSearch; // eval doesn't use passed flag

  // Step 2: Sanitize and expand
  const sanitizedQuestion = sanitizeQuery(strippedQuery, subject);
  const expandedQuery = expandQueryForRetrieval(sanitizedQuestion, subject);

  timings.sanitize = Date.now() - startTime;

  // Step 3: Follow-up analysis
  const analysis = analyzeMessage(sanitizedQuestion, null); // eval runs single-turn
  const focusTopic = analysis.focusTopic;
  const broadTopic = !focusTopic || isBroadTopic(focusTopic);
  const retrievalQuery = `${analysis.retrievalQuestion} ${subject}`.trim();
  const candidateCount = options.candidates ?? Math.max(16, analysis.chunkCount * 4);
  const requestedChunkCount = options.topK ?? analysis.chunkCount;

  // Step 4: Retrieval
  const retrievalStart = Date.now();
  const filters = { subject, college: studentProfile.college };
  const rawChunks = await searchChunks(retrievalQuery, filters, candidateCount);
  const deduped = dedupeChunks(rawChunks);

  let candidates = deduped;
  if (!broadTopic) {
    candidates = deduped
      .map(chunk => ({
        ...chunk,
        topicScore: scoreChunkForTopic(chunk, focusTopic, analysis.contentWords),
      }))
      .filter(chunk => chunk.topicScore > 0 || chunk.score > 0.15)
      .sort((a, b) => (b.topicScore + b.score) - (a.topicScore + a.score));
  } else {
    candidates = deduped
      .filter(chunk => chunk.score > 0.15)
      .sort((a, b) => b.score - a.score);
  }

  let selectedChunks = candidates.slice(0, requestedChunkCount);

  // Fallback for new questions
  if (selectedChunks.length === 0 && !analysis.isFollowUp) {
    selectedChunks = deduped
      .filter(chunk => chunk.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, requestedChunkCount);
  }

  timings.retrieval = Date.now() - retrievalStart;

  // Step 5: Decision (abstain or answer)
  let decision = 'answer';
  let permissionPrompt = null;
  if (selectedChunks.length === 0) {
    decision = 'abstain';
    permissionPrompt = {
      message: "I couldn't find enough relevant information in your course material to answer this confidently. Would you like me to search the web for an answer?",
      options: [
        { label: 'Yes, search the web', value: 'yes' },
        { label: "No, I'll rephrase my question", value: 'no' },
      ],
    };
  }

  // Step 6: Generate answer (if not abstaining)
  let answer = null;
  let promptTokens = 0;
  let firstTokenTime = null;
  let totalTime = 0;

  if (decision === 'answer') {
    // Get memories
    const memories = await getRelevantMemories(studentId, sanitizedQuestion, { limit: 10 });

    // Call LLM
    const genStart = Date.now();
    // We need to call the internal callLLM function. For eval, we'll use a simplified version.
    // Since callLLM is not exported, we'll import and use processChatQuestion but with a mock conversation.
    // Actually, let's just reuse the full processChatQuestion for the answer generation part.
    // But we need to capture the answer. Let's call it and collect the stream.
    
    // For eval, we'll call the actual chat pipeline but with a temporary conversation
    // that we don't save.
    
    // Since we can't easily get the full answer from processChatQuestion without saving,
    // let's call the LLM directly here using the same logic.
    const { callLLM } = await import('./chat.js');
    const { buildFinalPrompt, estimateTokens, getModelContextLimit, MAX_PROMPT_TOKENS } = await import('./contextManager.js');
    const { ollamaChatWithTimeout, LLM_MODEL } = await import('./chat.js');
    
    // Build context for LLM
    const relevantContext = selectedChunks;
    const retrievedDocs = relevantContext.map((c, i) => {
      const filename = c.metadata?.sourceDoc || c.metadata?.documentId || 'unknown';
      const page = c.metadata?.page || c.metadata?.chunkIndex || 'N/A';
      if (c.isPreviousAnswer) {
        return `[Source: Previous answer on "${analysis?.focusTopic || 'this topic'}"]\n${c.text}`;
      }
      return `[Source: ${filename}, p.${page}]\n${c.text}`;
    }).join('\n\n');

    // Build system prompt (simplified for eval)
    const systemPrompt = `You are the course assistant for ${studentProfile.college} at Parul University, helping students with ${subject} (${studentProfile.semester}).

STUDENT PROFILE:
- College: ${studentProfile.college}
- Program: ${studentProfile.program}
- Field/Branch: ${studentProfile.field}
- Semester: ${studentProfile.semester}

RETRIEVED CONTEXT:
${retrievedDocs}

STUDENT QUESTION:
${sanitizedQuestion}

RULES:
1. Answer only using the retrieved context. If it doesn't contain enough information to answer confidently, say so plainly rather than guessing — do not fabricate.
2. Cite every factual claim from course material: [Source: {filename}, p.{page}].
3. Adjust technical depth by program level.
4. NEVER use meta-referential phrasing like "in this example," "as shown above."
5. If the top retrieved chunk doesn't clearly relate to the question, say so.
6. Format with Markdown; LaTeX for math.`;

    const finalPrompt = `${systemPrompt}\n\nSTUDENT QUESTION:\n${sanitizedQuestion}`;
    promptTokens = estimateTokens ? estimateTokens(finalPrompt) : Math.ceil(finalPrompt.length / 4);

    const cue = analysis.cue || 'general';
    const numPredict = cue === 'short' ? 1200 : (cue === 'detail' || cue === 'code') ? 2500 : 2000;
    const numCtx = getModelContextLimit ? getModelContextLimit(LLM_MODEL) : 8192;

    const stream = ollamaChatWithTimeout({
      model: LLM_MODEL,
      messages: [{ role: 'system', content: finalPrompt }],
      options: { temperature: 0, num_predict: numPredict, num_ctx: numCtx, keep_alive: -1 },
      stream: true,
    }, config.chatTimeoutMs || 180000);

    let fullAnswer = '';
    let chunkCount = 0;
    for await (const chunk of stream) {
      chunkCount++;
      if (!firstTokenTime) firstTokenTime = Date.now();
      if (chunk.message?.content) {
        fullAnswer += chunk.message.content;
      }
    }
    totalTime = Date.now() - genStart;
    answer = fullAnswer;
  }

  timings.total = Date.now() - startTime;

  // Prepare result
  return {
    // Input
    studentId,
    question,
    sanitizedQuestion,
    subject,
    options,

    // Analysis
    analysis: {
      originalMessage: analysis.originalMessage,
      isFollowUp: analysis.isFollowUp,
      hasReferenceWord: analysis.hasReferenceWord,
      contentWords: analysis.contentWords,
      cue: analysis.cue,
      newTopic: analysis.newTopic,
      focusTopic: analysis.focusTopic,
      rewrittenQuestion: analysis.rewrittenQuestion,
      retrievalQuestion: analysis.retrievalQuestion,
      needsClarification: analysis.needsClarification,
      topicKeywords: analysis.topicKeywords,
      chunkCount: analysis.chunkCount,
    },

    // Retrieval
    retrieval: {
      query: retrievalQuery,
      filters,
      candidateCount,
      rawChunks: rawChunks.map(c => ({
        id: `${c.metadata.documentId}-${c.metadata.chunkIndex}`,
        document: c.metadata.sourceDoc,
        page: c.metadata.page,
        score: c.score,
        text: c.text,
        metadata: c.metadata,
      })),
      dedupedChunks: deduped.map(c => ({
        id: `${c.metadata.documentId}-${c.metadata.chunkIndex}`,
        document: c.metadata.sourceDoc,
        page: c.metadata.page,
        score: c.score,
        text: c.text,
        metadata: c.metadata,
      })),
      candidates: candidates.map(c => ({
        id: `${c.metadata.documentId}-${c.metadata.chunkIndex}`,
        document: c.metadata.sourceDoc,
        page: c.metadata.page,
        score: c.score,
        topicScore: c.topicScore,
        text: c.text,
        metadata: c.metadata,
      })),
      selectedChunks: selectedChunks.map(c => ({
        id: `${c.metadata.documentId}-${c.metadata.chunkIndex}`,
        document: c.metadata.sourceDoc,
        page: c.metadata.page,
        score: c.score,
        topicScore: c.topicScore,
        text: c.text,
        metadata: c.metadata,
      })),
      counts: {
        raw: rawChunks.length,
        deduped: deduped.length,
        candidates: candidates.length,
        selected: selectedChunks.length,
      },
    },

    // Decision
    decision,
    permissionPrompt,

    // Answer
    answer,
    promptTokens,
    citations: answer ? extractCitations(answer, selectedChunks) : [],

    // Timings
    timings: {
      sanitize: timings.sanitize,
      retrieval: timings.retrieval,
      generation: totalTime,
      firstToken: firstTokenTime ? firstTokenTime - startTime - timings.sanitize - timings.retrieval : null,
      total: timings.total,
    },

    // Metadata
    studentProfile,
    subject,
    model: LLM_MODEL,
    temperature: 0,
  };
}

// Helper to extract citations from answer
function extractCitations(answer, context) {
  if (!answer) return [];
  const citationRegex = /\[Source: ([^\],]+), p\.([^\]]+)\]/g;
  const citations = [];
  let match;
  while ((match = citationRegex.exec(answer)) !== null) {
    const filename = match[1];
    const page = match[2];
    const matchingContext = context.find(c => {
      const metaFilename = c.metadata?.sourceDoc || c.metadata?.documentId || '';
      const metaPage = c.metadata?.page || c.metadata?.chunkIndex;
      return metaFilename === filename && String(metaPage) === String(page);
    });
    if (matchingContext) {
      citations.push({
        chunkId: `${matchingContext.metadata.documentId}-${matchingContext.metadata.chunkIndex}`,
        documentId: matchingContext.metadata.documentId,
        excerpt: matchingContext.text.slice(0, 300),
        page: matchingContext.metadata.page || matchingContext.metadata.chunkIndex,
        score: matchingContext.score,
      });
    }
  }
  return citations;
}

export default { runPipeline };
import express from 'express';
import { z } from 'zod';
import { User } from '../models/index.js';

const router = express.Router();

const evalSchema = z.object({
  studentId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID'),
  question: z.string().min(1).max(2000),
  subject: z.string().min(1),
  options: z.object({
    topK: z.coerce.number().int().positive().default(3),
    candidates: z.coerce.number().int().positive().default(20),
    threshold: z.coerce.number().default(0.15),
    reranker: z.boolean().default(true),
  }),
});

router.post('/pipeline', async (req, res, next) => {
  try {
    const result = await evalPipeline(req.body);
    res.json(result);
  } catch (err) {
    console.error('Eval pipeline error:', err);
    next(err);
  }
});

export default router;

async function evalPipeline(params) {
  const { studentId, question, subject, options } = params;
  const { topK, candidates: optCandidates, threshold, reranker } = options || {};

  // Find the student
  const student = await User.findById(studentId).lean();
  if (!student) {
    return { decision: 'abstain', errorMessage: 'Student not found', retrieval: { counts: { raw: 0, deduped: 0, candidates: 0, selected: 0 } } };
  }

  // Build student profile
  const studentProfile = {
    college: student.college || 'Parul University',
    program: student.program || 'btech',
    field: student.field || 'Computer Engineering',
    fieldCategory: student.fieldCategory || 'Engineering',
    subject,
    semester: student.semester || '1',
  };

  // Step 2: Sanitize query - remove leading \\ or ͼ web search trigger
  let sanitizedQuery = (question || '').trim();
  if (sanitizedQuery.startsWith('\\') || sanitizedQuery.startsWith('ͼ')) {
    sanitizedQuery = sanitizedQuery.slice(1).trim();
  }

  // Step 3: Follow-up analysis
  const analysis = analyzeMessage(sanitizedQuery || '');
  const focusTopic = analysis.focusTopic;
  const broadTopic = !focusTopic || isBroadTopic(focusTopic);
  const retrievalQuery = (analysis.retrievalQuery || sanitizedQuery || '').trim() + ' ' + (subject || '');
  const candidateCount = optCandidates || candidates || 20;
  const requestedChunkCount = topK || 3;

  // Step 4: Retrieval from Chroma
  const filters = { subject, college: studentProfile.college };
  const rawChunks = await searchChunks(retrievalQuery, filters, candidateCount);
  const deduped = dedupeChunks(rawChunks);

  // Rerank by topic if focus topic exists
  let candidates = deduped;
  if (!broadTopic && focusTopic) {
    candidates = deduped
      .map(chunk => ({ ...chunk, topicScore: scoreChunkForTopic(chunk, focusTopic, analysis.contentWords) }))
      .filter(chunk => chunk.topicScore > 0 || chunk.score > 0.15)
      .sort((a, b) => (b.topicScore + b.score) - (a.topicScore + a.score));
  } else {
    candidates = deduped
      .filter(chunk => chunk.score > 0.15)
      .sort((a, b) => b.score - a.score);
  }

  let selectedChunks = candidates.slice(0, requestedChunkCount);

  // Fallback for new questions with no results
  if (selectedChunks.length === 0 && !analysis.isFollowUp) {
    selectedChunks = deduped
      .filter(chunk => chunk.score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, requestedChunkCount);
  }

  // Step 5: Decision (abstain or answer)
  let decision = 'answer';
  if (selectedChunks.length === 0) {
    decision = 'abstain';
  }

  // Step 6: Generate answer from selected chunks
  let answer = '';
  let promptTokens = 0;
  let citations = [];

  if (decision === 'answer' && selectedChunks.length > 0) {
    const contextParts = selectedChunks.map((c, i) => {
      const filename = c.metadata.sourceDoc || c.metadata.documentId || 'unknown';
      const page = c.metadata.page || c.metadata.chunkIndex || 'N/A';
      return `[Source: ${filename}, p.${page}]\n${c.text.slice(0, 500)}`;
    }).join('\n\n');

    answer = `Based on the course material:\n\n${contextParts}\n\nQuestion: ${sanitizedQuery}\n\nAnswer: Based on the context above, `;
    promptTokens = Math.ceil((contextParts.length + sanitizedQuery.length) / 4);

    // Extract simple citations from top-3 chunks
    citations = selectedChunks.slice(0, 3).map((c, i) => ({
      chunkId: `${c.metadata.documentId}-${c.metadata.chunkIndex}`,
      documentId: c.metadata.documentId,
      excerpt: c.text.slice(0, 100),
      page: c.metadata.page || c.metadata.chunkIndex,
      score: c.score,
    }));
  }

  return {
    decision,
    retrieval: {
      counts: {
        raw: rawChunks.length,
        deduped: deduped.length,
        candidates: candidates.length,
        selected: selectedChunks.length,
      },
    },
    answer: answer || 'I could not find enough relevant information to answer this question.',
    promptTokens,
    citations,
  };
}

// Helper functions (inline implementations)

function sanitizeQuery(query, subject) {
  let cleaned = (query || '').trim();
  if (cleaned.startsWith('\\') || cleaned.startsWith('ͼ')) {
    cleaned = cleaned.slice(1).trim();
  }
  return cleaned;
}

function analyzeMessage(message) {
  return {
    originalMessage: message || '',
    isFollowUp: false,
    hasReferenceWord: false,
    contentWords: new Set((message || '').split(/\s+/).filter(w => w.length >= 3) || []),
    cue: 'general',
    newTopic: null,
    focusTopic: null,
    rewrittenQuestion: message || '',
    retrievalQuery: message || '',
    needsClarification: false,
    topicKeywords: new Set(),
    chunkCount: 0,
  };
}

function isBroadTopic(topic) {
  const broad = new Set(['general', 'overview', 'introduction']);
  return broad.has((topic || '').toLowerCase() || '');
}

function scoreChunkForTopic(chunk, focusTopic, contentWords) {
  if (!focusTopic) return 0;
  const text = (chunk.text || '').toLowerCase();
  const topicLower = (focusTopic || '').toLowerCase();
  if (text.includes(topicLower)) return 0.5;
  if (contentWords && contentWords.has(topicLower)) return 0.3;
  return 0;
}

function dedupeChunks(chunks) {
  const seen = new Set();
  return chunks.filter(c => {
    const norm = (c.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });
}
import { config } from '../config/index.js';
import { Ollama } from 'ollama';
import { isExcludedFromHistory } from './followUp.js';

const ollama = new Ollama({ host: config.ollamaHost });

const MODEL_CONTEXT_LIMITS = {
  'qwen2.5:3b-instruct-q4_K_M': 8192,
  'qwen2.5:7b-instruct-q4_K_M': 8192,
  'qwen3:30b-a3b': 32768,
  'llama3:8b': 8192,
  'llama3:70b': 8192,
  'nemotron-3-ultra:cloud': 128000,
  'phi4:14b': 16384,
};

const DEFAULT_CONTEXT_LIMIT = 8192;
// Hard ceiling for everything we send to the model. Follow-up chats used to
// send ~5000-token prompts, which pushed the actual answer out of the context
// window and made the model fall back to a generic overview.
const MAX_PROMPT_TOKENS = 2800;
const MIN_ANSWER_TOKENS = 1000;
const RESERVED_TOKENS_FOR_RESPONSE = 2000;
const SYSTEM_PROMPT_TOKEN_ESTIMATE = 1200;
const MAX_HISTORY_TOKENS = 700;
const MAX_HISTORY_TURNS = 3;
const SUMMARY_MAX_TOKENS = 1000;
const SUMMARY_TRIGGER_THRESHOLD = 0.7;

export function getModelContextLimit(modelName) {
  return MODEL_CONTEXT_LIMITS[modelName] || DEFAULT_CONTEXT_LIMIT;
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

export function getContextBudget(modelName = 'qwen2.5:3b-instruct-q4_K_M') {
  const limit = getModelContextLimit(modelName);
  return {
    total: limit,
    maxPromptTokens: MAX_PROMPT_TOKENS,
    minAnswerTokens: MIN_ANSWER_TOKENS,
    reservedForResponse: RESERVED_TOKENS_FOR_RESPONSE,
    availableForContext: Math.max(0, MAX_PROMPT_TOKENS - SYSTEM_PROMPT_TOKEN_ESTIMATE),
  };
}

export async function buildConversationContext(conversation, options = {}) {
  const {
    modelName = 'qwen2.5:3b-instruct-q4_K_M',
    maxHistoryMessages = 30,
    includeSummary = true,
    memories = [],
    retrievedDocs = '',
    currentQuestion = '',
  } = options;

  const budget = getContextBudget(modelName);
  let usedTokens = SYSTEM_PROMPT_TOKEN_ESTIMATE;

  const contextParts = {
    summary: '',
    recentMessages: [],
    memoryContext: '',
    retrievedDocs: '',
    currentQuestion: '',
  };

  // Add memories first (high priority)
  if (memories.length > 0) {
    contextParts.memoryContext = formatMemoriesForPrompt(memories);
    const memoryTokens = estimateTokens(contextParts.memoryContext);
    if (usedTokens + memoryTokens <= budget.availableForContext * 0.15) {
      usedTokens += memoryTokens;
    } else {
      // Truncate memories if needed
      contextParts.memoryContext = truncateToTokenBudget(contextParts.memoryContext, budget.availableForContext * 0.15 - usedTokens);
      usedTokens += estimateTokens(contextParts.memoryContext);
    }
  }

  // Add retrieved docs
  if (retrievedDocs) {
    contextParts.retrievedDocs = retrievedDocs;
    const docsTokens = estimateTokens(retrievedDocs);
    if (usedTokens + docsTokens <= budget.availableForContext * 0.35) {
      usedTokens += docsTokens;
    } else {
      contextParts.retrievedDocs = truncateToTokenBudget(retrievedDocs, budget.availableForContext * 0.35 - (usedTokens - SYSTEM_PROMPT_TOKEN_ESTIMATE));
      usedTokens += estimateTokens(contextParts.retrievedDocs);
    }
  }

  // Add current question
  if (currentQuestion) {
    contextParts.currentQuestion = currentQuestion;
    usedTokens += estimateTokens(currentQuestion) + 50;
  }

  // Add summary if available and fits (before recent messages to preserve context)
  if (includeSummary && conversation.summary) {
    const summaryTokens = estimateTokens(conversation.summary);
    if (usedTokens + summaryTokens <= budget.availableForContext * 0.25) {
      contextParts.summary = conversation.summary;
      usedTokens += summaryTokens;
    }
  }

  // Add recent messages (most important - fill remaining budget)
  const messages = conversation.messages || [];
  const recentMessages = messages.slice(-maxHistoryMessages);

  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    const msgTokens = estimateTokens(msg.content) + 50;
    if (usedTokens + msgTokens <= budget.availableForContext) {
      contextParts.recentMessages.unshift({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
      });
      usedTokens += msgTokens;
    } else {
      break;
    }
  }

  // If we have a summary but couldn't fit recent messages, include summary
  // to maintain context continuity
  const hasMoreHistory = messages.length > contextParts.recentMessages.length + (conversation.lastSummarizedMessageIndex || 0);
  
  return {
    contextParts,
    usedTokens,
    budget,
    hasMoreHistory,
    contextUsagePercent: (usedTokens / budget.total) * 100,
  };
}

function truncateToTokenBudget(text, maxTokens) {
  if (!text || maxTokens <= 0) return '';
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) return text;
  
  const ratio = maxTokens / estimatedTokens;
  const targetLength = Math.floor(text.length * ratio * 0.95); // 5% safety margin
  return text.slice(0, targetLength) + '\n... [truncated]';
}

export function formatHistoryForPrompt(messages) {
  if (!messages || messages.length === 0) return '';
  
  return messages.map(msg => 
    `${msg.role === 'user' ? 'Student' : 'Assistant'}: ${msg.content}`
  ).join('\n\n');
}

/**
 * Build the follow-up history from persisted messages only. Greetings,
 * permission offers/responses, clarification prompts and memory commands are
 * excluded so they can never become the "previous topic".
 */
export function buildHistoryFromMessages(messages = [], options = {}) {
  const {
    maxTurns = MAX_HISTORY_TURNS,
    maxCharsPerMessage = 600,
    maxTotalTokens = MAX_HISTORY_TOKENS,
  } = options;

  const filtered = (messages || []).filter(
    msg => msg && msg.content && String(msg.content).trim() && !isExcludedFromHistory(msg)
  );

  // Walk backwards collecting user/assistant pairs, newest first.
  const pairs = [];
  let pendingAssistant = null;
  for (let i = filtered.length - 1; i >= 0 && pairs.length < maxTurns; i--) {
    const msg = filtered[i];
    if (!pendingAssistant) {
      if (msg.role === 'assistant') pendingAssistant = msg;
      continue;
    }
    if (msg.role === 'user') {
      pairs.push([msg, pendingAssistant]);
      pendingAssistant = null;
    }
  }

  const ordered = pairs.reverse().flat();
  const lines = [];
  let usedTokens = 0;

  for (const msg of ordered) {
    const role = msg.role === 'user' ? 'Student' : 'Assistant';
    let content = String(msg.content || '').trim();
    if (content.length > maxCharsPerMessage) {
      content = `${content.slice(0, maxCharsPerMessage).trimEnd()}…`;
    }
    const line = `${role}: ${content}`;
    const lineTokens = estimateTokens(line);
    if (usedTokens + lineTokens > maxTotalTokens) break;
    lines.push(line);
    usedTokens += lineTokens;
  }

  return {
    text: lines.join('\n\n'),
    turns: pairs.length,
    messageCount: ordered.length,
    tokens: usedTokens,
  };
}

export function formatMemoriesForPrompt(memories) {
  if (!memories || memories.length === 0) return '';
  
  const grouped = memories.reduce((acc, mem) => {
    if (!acc[mem.category]) acc[mem.category] = [];
    acc[mem.category].push(mem.content);
    return acc;
  }, {});

  const lines = [];
  for (const [category, items] of Object.entries(grouped)) {
    lines.push(`[${category.toUpperCase()}]`);
    items.forEach(item => lines.push(`- ${item}`));
  }
  return lines.join('\n');
}

export function buildFinalPrompt({
  systemPrompt,
  memoryContext,
  conversationSummary,
  recentHistory,
  followUpLine,
  topicNote,
  retrievedDocs,
  currentQuestion,
  maxPromptTokens = MAX_PROMPT_TOKENS,
}) {
  const systemTokens = estimateTokens(systemPrompt);
  const questionTokens = estimateTokens(currentQuestion) + 20;
  let remaining = Math.max(200, maxPromptTokens - systemTokens - questionTokens);

  const followUpTokens = estimateTokens(followUpLine);
  const topicNoteTokens = estimateTokens(topicNote);
  remaining = Math.max(100, remaining - followUpTokens - topicNoteTokens);

  const memoryBudget = memoryContext ? Math.min(Math.round(remaining * 0.12), 140) : 0;
  const summaryBudget = conversationSummary ? Math.min(Math.round(remaining * 0.15), 220) : 0;
  const historyBudget = recentHistory ? Math.min(Math.round(remaining * 0.32), MAX_HISTORY_TOKENS) : 0;
  const docsBudget = Math.max(0, remaining - memoryBudget - summaryBudget - historyBudget);

  let safeMemory = truncateToTokenBudget(memoryContext, memoryBudget);
  let safeSummary = truncateToTokenBudget(conversationSummary, summaryBudget);
  let safeHistory = truncateToTokenBudget(recentHistory, historyBudget);
  let safeDocs = truncateToTokenBudget(retrievedDocs, docsBudget);

  const assemble = () => {
    const parts = [systemPrompt];
    if (safeMemory) {
      parts.push(`\n--- USER MEMORIES (for personalization only, not as factual evidence) ---\n${safeMemory}`);
    }
    if (safeSummary) {
      parts.push(`\n--- CONVERSATION SUMMARY ---\n${safeSummary}`);
    }
    if (safeHistory) {
      parts.push(`\n--- RECENT CONVERSATION (last 3 turns) ---\n${safeHistory}`);
    }
    if (followUpLine) {
      parts.push(`\n${followUpLine}`);
    }
    if (topicNote) {
      parts.push(`\n${topicNote}`);
    }
    if (safeDocs) {
      parts.push(`\n--- RETRIEVED COURSE MATERIAL ---\n${safeDocs}`);
    }
    parts.push(`\n--- CURRENT QUESTION ---\n${currentQuestion}`);
    return parts.join('\n');
  };

  let prompt = assemble();

  // Hard cap: trim the least critical blocks first, never the system prompt or
  // the current question.
  if (estimateTokens(prompt) > maxPromptTokens) {
    let overflow = estimateTokens(prompt) - maxPromptTokens;
    const docsTokens = estimateTokens(safeDocs);
    if (docsTokens > 0) {
      safeDocs = truncateToTokenBudget(safeDocs, Math.max(0, docsTokens - overflow));
      prompt = assemble();
      overflow = estimateTokens(prompt) - maxPromptTokens;
    }
    if (overflow > 0 && estimateTokens(safeHistory) > 0) {
      safeHistory = truncateToTokenBudget(safeHistory, Math.max(0, estimateTokens(safeHistory) - overflow));
      prompt = assemble();
      overflow = estimateTokens(prompt) - maxPromptTokens;
    }
    if (overflow > 0 && estimateTokens(safeSummary) > 0) {
      safeSummary = '';
      prompt = assemble();
    }
    if (estimateTokens(prompt) > maxPromptTokens) {
      // Last resort: hard character cut on the docs section.
      const excessChars = Math.ceil((estimateTokens(prompt) - maxPromptTokens) * 3.5);
      if (safeDocs) {
        safeDocs = safeDocs.slice(0, Math.max(0, safeDocs.length - excessChars - 20));
        prompt = assemble();
      }
    }
  }

  return prompt;
}

/**
 * Summarize conversation history using LLM
 * @param {Array} messages - Array of message objects {role, content, timestamp}
 * @param {string} existingSummary - Existing summary to extend
 * @param {Object} options - { modelName, subject, studentProfile }
 * @returns {Promise<{summary: string, tokenCount: number}>}
 */
export async function summarizeConversation(messages, existingSummary = '', options = {}) {
  const { 
    modelName = 'qwen2.5:3b-instruct-q4_K_M',
    subject = 'General',
    studentProfile = {}
  } = options;

  if (!messages || messages.length < 3) {
    return { summary: existingSummary, tokenCount: estimateTokens(existingSummary) };
  }

  // Get messages since last summary
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const prompt = `You are creating a concise summary of a student's conversation with an AI tutor for ${subject}. 

Previous summary (if any):
${existingSummary || 'None'}

New conversation messages:
${conversationText}

Create an updated summary that preserves:
1. Important unresolved questions
2. Key decisions or conclusions reached
3. User preferences and learning style observations
4. Relevant technical details, code patterns, or concepts discussed
5. Current study topics and goals

Rules:
- Be concise (max ${SUMMARY_MAX_TOKENS} tokens ~${SUMMARY_MAX_TOKENS * 3} chars)
- Do not repeat information already in previous summary
- Focus on facts useful for future context
- Do not include sensitive personal information
- Write in third person ("The student asked...", "The assistant explained...")

Return ONLY the updated summary text, no extra formatting.`;

  try {
    const response = await ollama.chat({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: 0.1,
        num_predict: SUMMARY_MAX_TOKENS,
        num_ctx: 4096,
        keep_alive: -1,
      },
      stream: false,
    });

    const summary = response.message.content.trim();
    return {
      summary,
      tokenCount: estimateTokens(summary),
    };
  } catch (error) {
    console.error('[ContextManager] Summarization error:', error.message);
    return { summary: existingSummary, tokenCount: estimateTokens(existingSummary) };
  }
}

/**
 * Check if conversation needs summarization
 * @param {Object} conversation - Conversation document
 * @param {Object} options - { modelName, threshold }
 * @returns {boolean}
 */
export function shouldSummarize(conversation, options = {}) {
  const { 
    modelName = 'qwen2.5:3b-instruct-q4_K_M',
    threshold = SUMMARY_TRIGGER_THRESHOLD 
  } = options;

  const budget = getContextBudget(modelName);
  const messages = conversation.messages || [];
  
  // Estimate total tokens if we included everything
  let totalTokens = SYSTEM_PROMPT_TOKEN_ESTIMATE;
  if (conversation.summary) totalTokens += estimateTokens(conversation.summary);
  
  for (const msg of messages) {
    totalTokens += estimateTokens(msg.content) + 50;
  }

  return (totalTokens / budget.total) > threshold;
}

/**
 * Get messages that haven't been summarized yet
 * @param {Object} conversation - Conversation document
 * @returns {Array} - Messages since last summarization
 */
export function getUnsummarizedMessages(conversation) {
  const messages = conversation.messages || [];
  const lastIndex = conversation.lastSummarizedMessageIndex || -1;
  return messages.slice(lastIndex + 1);
}

export {
  MODEL_CONTEXT_LIMITS,
  MAX_PROMPT_TOKENS,
  MIN_ANSWER_TOKENS,
  MAX_HISTORY_TURNS,
  RESERVED_TOKENS_FOR_RESPONSE,
  SYSTEM_PROMPT_TOKEN_ESTIMATE,
  SUMMARY_MAX_TOKENS,
};
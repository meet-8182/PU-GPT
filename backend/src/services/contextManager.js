import { config } from '../config/index.js';
import { Ollama } from 'ollama';

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
const RESERVED_TOKENS_FOR_RESPONSE = 2000;
const SYSTEM_PROMPT_TOKEN_ESTIMATE = 1500;
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
    reservedForResponse: RESERVED_TOKENS_FOR_RESPONSE,
    availableForContext: limit - RESERVED_TOKENS_FOR_RESPONSE - SYSTEM_PROMPT_TOKEN_ESTIMATE,
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
  retrievedDocs,
  currentQuestion,
}) {
  const parts = [systemPrompt];

  if (memoryContext) {
    parts.push(`\n--- USER MEMORIES (for personalization only, not as factual evidence) ---\n${memoryContext}`);
  }

  if (conversationSummary) {
    parts.push(`\n--- CONVERSATION SUMMARY ---\n${conversationSummary}`);
  }

  if (recentHistory) {
    parts.push(`\n--- RECENT CONVERSATION ---\n${recentHistory}`);
  }

  if (retrievedDocs) {
    parts.push(`\n--- RETRIEVED COURSE MATERIAL ---\n${retrievedDocs}`);
  }

  parts.push(`\n--- CURRENT QUESTION ---\n${currentQuestion}`);

  return parts.join('\n');
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
  RESERVED_TOKENS_FOR_RESPONSE,
  SYSTEM_PROMPT_TOKEN_ESTIMATE,
  SUMMARY_MAX_TOKENS,
};
/**
 * Rule-based follow-up detection, topic tracking and deterministic rewriting.
 *
 * The small local model cannot be trusted to infer what "explain in detail"
 * refers to, so the decision is made here with deterministic rules. The LLM is
 * only used elsewhere for the answer itself.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because',
  'as', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'without',
  'about', 'into', 'over', 'under', 'between', 'among', 'through', 'during',
  'before', 'after', 'above', 'below', 'up', 'down', 'out', 'off', 'again',
  'further', 'once', 'here', 'there', 'when', 'where', 'while', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'having', 'can', 'could', 'should', 'would', 'will',
  'shall', 'may', 'might', 'must', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'she', 'it', 'its', 'they', 'them', 'their', 'us', 'please', 'kindly',
  'some', 'any', 'all', 'each', 'every', 'both', 'either', 'neither', 'not',
  'no', 'yes', 'ok', 'okay', 'just', 'only', 'also', 'very', 'really', 'quite',
  'too', 'much', 'many', 'few', 'little', 'own', 'same', 'such', 'what',
  'which', 'who', 'whom', 'whose', 'why', 'how', 'whether',
]);

const INSTRUCTION_WORDS = new Set([
  'explain', 'explains', 'explained', 'explaining', 'explanation',
  'detail', 'details', 'detailed', 'short', 'brief', 'briefly', 'more',
  'example', 'examples', 'code', 'coding', 'program', 'programs', 'programming',
  'implement', 'implementation', 'implementations', 'elaborate', 'elaboration',
  'again', 'simpler', 'simple', 'summary', 'summarize', 'summarise', 'steps',
  'step', 'tell', 'describe', 'description', 'give', 'show', 'write', 'list',
  'define', 'definition', 'discuss', 'compare', 'difference', 'differences',
  'deep', 'depth', 'thorough', 'comprehensive', 'clear', 'clarify', 'help',
  'understand', 'know', 'learn', 'study', 'revise', 'revision',
]);

const REFERENCE_WORDS = new Set([
  'it', 'its', 'this', 'that', 'these', 'those', 'above', 'same', 'previous',
  'previously', 'more', 'further', 'other', 'another', 'them', 'they', 'he',
  'she', 'former', 'latter', 'aforementioned',
]);

const GENERIC_TOPIC_WORDS = new Set([
  'data', 'structure', 'structures', 'type', 'types', 'concept', 'concepts',
  'topic', 'topics', 'subject', 'subjects', 'course', 'courses', 'material',
  'materials', 'note', 'notes', 'document', 'documents', 'pdf', 'pdfs', 'file',
  'files', 'thing', 'things', 'definition', 'definitions', 'meaning',
  'overview', 'introduction', 'introductions', 'example', 'examples', 'code',
  'program', 'programs', 'implementation', 'implementations', 'use', 'uses',
  'usage', 'application', 'applications', 'advantage', 'advantages',
  'disadvantage', 'disadvantages', 'feature', 'features', 'characteristic',
  'characteristics', 'operation', 'operations', 'key', 'main', 'basic',
  'important', 'general', 'whole', 'entire', 'part', 'parts', 'work', 'works',
  'working', 'works', 'difference', 'differences', 'between', 'compare',
  'comparison', 'point', 'points', 'question', 'questions', 'answer', 'answers',
]);

const TOPIC_RELATED_TERMS = {
  stack: ['lifo', 'push', 'pop', 'peek', 'stack pointer', 'top of the stack'],
  stacks: ['lifo', 'push', 'pop', 'peek', 'stack pointer', 'top of the stack'],
  queue: ['fifo', 'enqueue', 'dequeue', 'front', 'rear'],
  queues: ['fifo', 'enqueue', 'dequeue', 'front', 'rear'],
  'linked list': ['linked list', 'linked lists', 'node', 'nodes', 'pointer', 'pointers'],
  'doubly linked list': ['doubly linked list', 'node', 'nodes', 'previous pointer', 'next pointer'],
  array: ['array', 'arrays', 'index', 'indices', 'contiguous'],
  arrays: ['array', 'arrays', 'index', 'indices', 'contiguous'],
  tree: ['tree', 'trees', 'root', 'leaf', 'leaves', 'child', 'children', 'parent'],
  trees: ['tree', 'trees', 'root', 'leaf', 'leaves', 'child', 'children', 'parent'],
  graph: ['graph', 'graphs', 'vertex', 'vertices', 'edge', 'edges'],
  graphs: ['graph', 'graphs', 'vertex', 'vertices', 'edge', 'edges'],
};

export const FOLLOW_UP_CUES = ['detail', 'short', 'code', 'example', 'why', 'how', 'steps', 'simpler'];

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’']s\b/g, '')
    .replace(/[^a-z0-9+#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text) {
  return normalizeText(text).split(' ').filter(Boolean);
}

export function singularize(word) {
  if (!word || word.length < 3) return word;
  const exceptions = new Set(['analysis', 'basis', 'class', 'process', 'access', 'gas', 'bus', 'status']);
  if (exceptions.has(word)) return word;
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function wordVariants(word) {
  const base = singularize(word);
  const variants = new Set([word, base, `${base}s`, `${base}es`]);
  if (base.endsWith('y')) variants.add(`${base.slice(0, -1)}ies`);
  return [...variants].filter(Boolean);
}

function hasReferenceWord(tokens) {
  return tokens.some(t => REFERENCE_WORDS.has(t));
}

function isContentToken(token) {
  if (!token || token.length < 2) return false;
  if (STOPWORDS.has(token)) return false;
  if (INSTRUCTION_WORDS.has(token)) return false;
  if (REFERENCE_WORDS.has(token)) return false;
  return true;
}

export function getContentWords(message) {
  return tokenize(message).filter(isContentToken);
}

export function detectCue(message) {
  const lower = normalizeText(message);
  if (/\b(in short|short|brief|briefly|summary|summarize|summarise|concise)\b/.test(lower)) return 'short';
  if (/\b(code|coding|program|programming|implement|implementation|snippet)\b/.test(lower)) return 'code';
  if (/\b(in detail|detail|detailed|elaborate|in depth|deep|thorough|comprehensive|more)\b/.test(lower)) return 'detail';
  if (/\b(example|examples|instance|illustration)\b/.test(lower)) return 'example';
  if (/\b(why)\b/.test(lower)) return 'why';
  if (/\b(how)\b/.test(lower)) return 'how';
  if (/\b(steps|step by step|procedure)\b/.test(lower)) return 'steps';
  if (/\b(simpler|simple|easier|beginner)\b/.test(lower)) return 'simpler';
  return 'general';
}

export function isFollowUpMessage(message) {
  const tokens = tokenize(message);
  if (tokens.length === 0) return false;
  if (hasReferenceWord(tokens)) return true;
  return getContentWords(message).length === 0;
}

function cleanTopicCandidate(candidate) {
  const contentWords = tokenize(candidate)
    .filter(isContentToken)
    .map(singularize)
    .filter(Boolean);
  // Prefer specific words ("stack", "linked list") but fall back to the full
  // content phrase for legitimately broad questions such as "data structures".
  const specific = contentWords.filter(t => !GENERIC_TOPIC_WORDS.has(t));
  const chosen = specific.length ? specific : contentWords;

  // Keep the phrase short so it can be used in a prompt and a keyword filter.
  const unique = [];
  for (const word of chosen) {
    if (!unique.includes(word)) unique.push(word);
    if (unique.length >= 3) break;
  }
  return unique.length ? unique.join(' ') : null;
}

/**
 * Extract the topic of a self-contained question. Returns a lowercase phrase
 * such as "stack", "queue" or "linked list", or null when the question is too
 * vague to have a topic.
 */
export function extractFocusTopic(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const patterns = [
    /^\s*(?:what|who)\s+(?:is|are|was|were)\s+(?:a|an|the)?\s*(.+)$/i,
    /^\s*what\s+about\s+(.+)$/i,
    /^\s*(?:define|describe)\s+(.+)$/i,
    /^\s*(?:explain|tell\s+me\s+about|give\s+me\s+(?:info|information)\s+about)\s+(.+)$/i,
    /^\s*difference\s+between\s+(.+)$/i,
    /^\s*(?:what\s+are\s+the\s+)?(?:types|classification)\s+of\s+(.+)$/i,
    /^\s*how\s+(?:does|do|is|are)\s+(.+?)(?:\s+work(?:s)?)?$/i,
    /^\s*why\s+(?:is|are|do|does)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const topic = cleanTopicCandidate(match[1]);
      if (topic) return topic;
    }
  }

  return cleanTopicCandidate(text);
}

export function buildFollowUpQuestion(originalMessage, focusTopic, cue = detectCue(originalMessage)) {
  const topic = focusTopic || 'this topic';
  switch (cue) {
    case 'short':
      return `Explain ${topic} in short`;
    case 'code':
      return `Explain ${topic} with code`;
    case 'example':
      return `Give an example of ${topic}`;
    case 'why':
      return `Explain why ${topic} is used`;
    case 'how':
      return `Explain how ${topic} works`;
    case 'steps':
      return `Explain the steps of ${topic}`;
    case 'simpler':
      return `Explain ${topic} in simpler terms`;
    case 'detail':
      return `Explain ${topic} in detail`;
    case 'general':
    default:
      return `Explain ${topic}`;
  }
}

export function chunkCountForCue(cue) {
  if (cue === 'detail') return 4;
  if (cue === 'short') return 2;
  return 3;
}

export function topicKeywords(focusTopic, extraWords = []) {
  if (!focusTopic) return [...new Set(extraWords.filter(Boolean))];
  const baseWords = tokenize(focusTopic);
  const terms = new Set();
  for (const word of baseWords) {
    for (const variant of wordVariants(word)) terms.add(variant);
  }
  for (const related of TOPIC_RELATED_TERMS[focusTopic] || TOPIC_RELATED_TERMS[baseWords.join(' ')] || []) {
    terms.add(related);
  }
  for (const word of extraWords) {
    if (!isContentToken(word) || GENERIC_TOPIC_WORDS.has(word)) continue;
    for (const variant of wordVariants(word)) terms.add(variant);
  }
  return [...terms].filter(Boolean);
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
  return (haystack.match(regex) || []).length;
}

export function isBroadTopic(focusTopic) {
  const words = tokenize(focusTopic);
  if (words.length === 0) return true;
  return words.every(word => GENERIC_TOPIC_WORDS.has(word));
}

/**
 * Returns a relevance score for a chunk against the focus topic. A score of 0
 * means the chunk is not about the topic and must not be used to answer.
 */
export function scoreChunkForTopic(chunk, focusTopic, extraWords = []) {
  if (!focusTopic) return 0;
  const text = normalizeText(`${chunk.text || ''} ${chunk.metadata?.sourceDoc || ''} ${chunk.metadata?.text || ''}`);
  if (!text) return 0;

  const focusWords = tokenize(focusTopic).filter(Boolean);
  if (focusWords.length === 0) return 0;

  let score = 0;
  let matchedAny = false;
  const sourceTitle = normalizeText(chunk.metadata?.sourceDoc || '');
  const relatedTerms = TOPIC_RELATED_TERMS[focusTopic]
    || TOPIC_RELATED_TERMS[singularize(focusTopic)]
    || [];

  for (const word of focusWords) {
    const variants = wordVariants(word);
    let wordHits = 0;
    for (const variant of variants) wordHits += countOccurrences(text, variant);

    if (wordHits > 0) {
      matchedAny = true;
      score += Math.min(wordHits, 5);
      if (sourceTitle && variants.some(v => sourceTitle.includes(v))) score += 4;
      continue;
    }

    // Multi-word topics such as "linked list" may not contain every word in a
    // single chunk. A related term (node/pointer, fifo, lifo) still counts.
    const wordRelated = TOPIC_RELATED_TERMS[word] || TOPIC_RELATED_TERMS[singularize(word)] || [];
    const relatedHits = [...relatedTerms, ...wordRelated]
      .reduce((sum, term) => sum + countOccurrences(text, term), 0);
    if (relatedHits > 0) {
      matchedAny = true;
      score += Math.min(relatedHits, 3);
    }
  }

  if (!matchedAny) return 0;

  // Exact phrase bonus, e.g. "linked list".
  if (focusWords.length > 1 && text.includes(normalizeText(focusTopic))) score += 3;

  for (const word of extraWords) {
    if (!word || !isContentToken(word) || GENERIC_TOPIC_WORDS.has(word)) continue;
    score += Math.min(wordVariants(word).reduce((sum, v) => sum + countOccurrences(text, v), 0), 2);
  }

  return score;
}

export function dedupeChunks(chunks) {
  const kept = [];
  const seenKeys = new Set();
  const seenText = new Set();

  for (const chunk of chunks) {
    const docId = chunk.metadata?.documentId || '';
    const chunkIndex = chunk.metadata?.chunkIndex;
    const key = docId && chunkIndex !== undefined ? `${docId}:${chunkIndex}:${chunk.metadata?.page ?? ''}` : null;
    const fingerprint = normalizeText(chunk.text || '').slice(0, 300);

    if (key && seenKeys.has(key)) continue;
    if (fingerprint && seenText.has(fingerprint)) continue;
    if (key) seenKeys.add(key);
    if (fingerprint) seenText.add(fingerprint);
    kept.push(chunk);
  }

  return kept;
}

export function analyzeMessage(message, previousFocusTopic = null) {
  const originalMessage = String(message || '').trim();
  const tokens = tokenize(originalMessage);
  const contentWords = getContentWords(originalMessage);
  const reference = hasReferenceWord(tokens);
  const isFollowUp = tokens.length > 0 && (reference || contentWords.length === 0);
  const cue = detectCue(originalMessage);
  const newTopic = isFollowUp ? null : extractFocusTopic(originalMessage);
  const focusTopic = isFollowUp ? (previousFocusTopic || null) : (newTopic || null);
  const needsClarification = isFollowUp
    ? !previousFocusTopic
    : !newTopic;

  const rewrittenQuestion = isFollowUp && focusTopic
    ? buildFollowUpQuestion(originalMessage, focusTopic, cue)
    : originalMessage;

  let retrievalQuestion = rewrittenQuestion;
  if (!isFollowUp && newTopic && !normalizeText(originalMessage).includes(normalizeText(newTopic))) {
    retrievalQuestion = `${originalMessage} ${newTopic}`.trim();
  }

  return {
    originalMessage,
    isFollowUp,
    hasReferenceWord: reference,
    contentWords,
    cue,
    newTopic,
    focusTopic,
    previousFocusTopic: previousFocusTopic || null,
    rewrittenQuestion,
    retrievalQuestion,
    needsClarification,
    topicKeywords: topicKeywords(focusTopic, contentWords),
    chunkCount: chunkCountForCue(cue),
  };
}

const GREETINGS = [
  'hi', 'hello', 'hey', 'hi there', 'hello there', 'hey there',
  'good morning', 'good afternoon', 'good evening',
  'how are you', 'how are you doing', 'how do you do',
  'whats up', "what's up", 'sup', 'thanks', 'thank you', 'thanks!',
  'thank you!', 'bye', 'bye bye', 'goodbye', 'see you', 'see ya',
  'nice to meet you', 'pleasure meeting you', 'have a good day', 'have a nice day',
];

export function isGreetingMessage(message) {
  const normalized = String(message || '').toLowerCase().trim();
  if (!normalized) return false;
  return GREETINGS.some(g => normalized === g || normalized.startsWith(`${g} `) || normalized.endsWith(` ${g}`));
}

export function isPermissionOfferMessage(message) {
  const lower = String(message || '').toLowerCase();
  return lower.includes('would you like me to search the web')
    || lower.includes("couldn't find enough relevant information")
    || lower.includes('could not find enough relevant information')
    || lower.includes('search the web for an answer');
}

export function isClarificationMessage(message) {
  const lower = String(message || '').toLowerCase().trim();
  return lower === 'which topic would you like explained?'
    || lower.startsWith('which topic would you like');
}

export function isPermissionResponseMessage(message) {
  const lower = String(message || '').toLowerCase().trim();
  return lower === 'yes, search the web'
    || lower === "no, i'll rephrase my question"
    || lower === 'no, i will rephrase my question';
}

export function isExcludedFromHistory(message) {
  if (message?.kind && message.kind !== 'normal') return true;
  if (!message?.content) return true;
  if (isGreetingMessage(message.content)) return true;
  if (isPermissionOfferMessage(message.content)) return true;
  if (isPermissionResponseMessage(message.content)) return true;
  if (isClarificationMessage(message.content)) return true;
  return false;
}

export {
  STOPWORDS,
  INSTRUCTION_WORDS,
  REFERENCE_WORDS,
  GENERIC_TOPIC_WORDS,
  TOPIC_RELATED_TERMS,
};

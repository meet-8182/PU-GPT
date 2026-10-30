import { z } from 'zod';
import express from 'express';
import { Document, Conversation } from '../models/index.js';
import { requireAuth, authorize, validate, validateQuery, AppError } from '../middleware/index.js';
import { 
  STOPWORDS, 
  INSTRUCTION_WORDS, 
  REFERENCE_WORDS, 
  GENERIC_TOPIC_WORDS,
  normalizeText,
  tokenize,
  singularize
} from '../services/followUp.js';

const router = express.Router();

router.use(requireAuth);

/**
 * Build a topic vocabulary for a subject from uploaded documents.
 * Extracts meaningful topic phrases from document titles and units.
 */
async function buildTopicVocabulary(subject, college = 'Parul University') {
  const docs = await Document.find({ 
    subject, 
    college,
    status: 'indexed' 
  }).select('title unit').lean();

  const vocabulary = new Map(); // topic -> { count, aliases: Set }
  
  for (const doc of docs) {
    // Extract from title
    if (doc.title) {
      const titleTopics = extractTopicsFromText(doc.title);
      for (const topic of titleTopics) {
        addToVocabulary(vocabulary, topic, doc.title);
      }
    }
    // Extract from unit
    if (doc.unit) {
      const unitTopics = extractTopicsFromText(doc.unit);
      for (const topic of unitTopics) {
        addToVocabulary(vocabulary, topic, doc.unit);
      }
    }
  }

  // Also add common CS topic aliases
  const commonAliases = getCommonAliases(subject);
  for (const [topic, aliases] of Object.entries(commonAliases)) {
    if (vocabulary.has(topic)) {
      for (const alias of aliases) vocabulary.get(topic).aliases.add(alias);
    } else {
      vocabulary.set(topic, { count: 1, aliases: new Set(aliases) });
    }
  }

  return vocabulary;
}

function extractTopicsFromText(text) {
  if (!text) return [];
  // Split on common delimiters and clean
  const parts = text
    .split(/[,\-:;|/]| and | or | & /)
    .map(p => p.trim())
    .filter(p => p.length >= 3 && p.length <= 50);
  
  const topics = [];
  for (const part of parts) {
    const normalized = normalizeText(part);
    const tokens = tokenize(normalized);
    // Keep meaningful phrases (2-4 words) or single specific terms
    if (tokens.length >= 2 && tokens.length <= 4) {
      const cleaned = tokens.filter(t => !GENERIC_TOPIC_WORDS.has(t) && !STOPWORDS.has(t));
      if (cleaned.length >= 2) {
        topics.push(cleaned.join(' '));
      }
    } else if (tokens.length === 1) {
      const token = tokens[0];
      if (!GENERIC_TOPIC_WORDS.has(token) && !STOPWORDS.has(token) && !INSTRUCTION_WORDS.has(token) && token.length >= 3) {
        topics.push(token);
      }
    }
  }
  return [...new Set(topics)];
}

function addToVocabulary(vocab, topic, source) {
  const normalized = normalizeText(topic);
  if (!normalized) return;
  if (!vocab.has(normalized)) {
    vocab.set(normalized, { count: 0, aliases: new Set([normalized, singularize(normalized)]) });
  }
  vocab.get(normalized).count++;
  // Add variations as aliases
  const tokens = tokenize(normalized);
  for (const token of tokens) {
    vocab.get(normalized).aliases.add(singularize(token));
  }
}

function getCommonAliases(subject) {
  const common = {
    'Data Structures': {
      'stack': ['stack', 'stacks', 'lifo', 'push', 'pop', 'peek'],
      'queue': ['queue', 'queues', 'fifo', 'enqueue', 'dequeue'],
      'linked list': ['linked list', 'linked lists', 'singly linked list', 'doubly linked list'],
      'array': ['array', 'arrays', 'dynamic array'],
      'tree': ['tree', 'trees', 'binary tree', 'bst', 'avl tree', 'heap'],
      'graph': ['graph', 'graphs', 'directed graph', 'undirected graph'],
      'hash table': ['hash table', 'hash map', 'hashtable', 'hashmap'],
      'sorting': ['sorting', 'sort', 'quicksort', 'mergesort', 'heapsort', 'bubblesort'],
      'searching': ['searching', 'search', 'binary search', 'linear search'],
      'recursion': ['recursion', 'recursive'],
      'dynamic programming': ['dynamic programming', 'dp', 'memoization', 'tabulation'],
      'time complexity': ['time complexity', 'big o', 'big-o', 'complexity analysis'],
      'space complexity': ['space complexity', 'memory complexity'],
    },
    'Algorithms': {
      'sorting': ['sorting', 'sort', 'quicksort', 'mergesort', 'heapsort'],
      'searching': ['searching', 'search', 'binary search'],
      'graph algorithms': ['graph algorithms', 'dfs', 'bfs', 'dijkstra', 'kruskal', 'prim'],
      'dynamic programming': ['dynamic programming', 'dp'],
      'greedy': ['greedy', 'greedy algorithm'],
      'divide and conquer': ['divide and conquer'],
    },
    'Database Systems': {
      'relational model': ['relational model', 'relation', 'tuple', 'attribute'],
      'sql': ['sql', 'structured query language', 'query'],
      'normalization': ['normalization', 'normal form', '1nf', '2nf', '3nf', 'bcnf'],
      'transactions': ['transaction', 'acid', 'commit', 'rollback'],
      'indexing': ['index', 'indexing', 'b-tree', 'b+tree', 'hash index'],
    },
  };
  return common[subject] || {};
}

/**
 * Match a question to a topic from the vocabulary.
 * Returns the matched topic or null if unclassified.
 */
function matchTopic(question, vocabulary) {
  if (!vocabulary || vocabulary.size === 0) return null;
  
  const normalized = normalizeText(question);
  const tokens = tokenize(normalized);
  
  // First, try exact topic phrase matches (longest first)
  const sortedTopics = [...vocabulary.keys()].sort((a, b) => b.length - a.length);
  for (const topic of sortedTopics) {
    if (normalized.includes(normalizeText(topic))) {
      return topic;
    }
  }
  
  // Then try alias matching
  for (const [topic, data] of vocabulary.entries()) {
    for (const alias of data.aliases) {
      if (normalized.includes(normalizeText(alias))) {
        return topic;
      }
    }
  }
  
  // Finally, try token-based fuzzy matching (edit distance 2)
  for (const token of tokens) {
    if (token.length < 4) continue;
    for (const [topic, data] of vocabulary.entries()) {
      for (const alias of data.aliases) {
        if (alias.length >= 4 && editDistance(token, alias) <= 2) {
          return topic;
        }
      }
    }
  }
  
  return null;
}

function editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

// Teacher insights endpoint
router.get('/insights', authorize('teacher', 'admin'), validateQuery(z.object({
  subject: z.string().optional().or(z.literal('')),
  days: z.coerce.number().int().positive().default(7),
}).transform(d => ({ ...d, subject: d.subject === '' ? undefined : d.subject }))), async (req, res, next) => {
  try {
    const { subject, days } = req.query;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const filter = { createdAt: { $gte: cutoff } };
    if (req.user.role === 'teacher') {
      filter.subject = { $in: req.user.subjects };
    }
    if (subject) filter.subject = subject;

    // Fetch conversations with messages
    const conversations = await Conversation.find({ 
      studentId: { $exists: true },
      updatedAt: { $gte: cutoff },
      ...(subject ? { subject } : {}),
    }).lean();

    // Build topic vocabulary for the subject(s)
    const subjectsToAnalyze = subject ? [subject] : (req.user.role === 'teacher' ? req.user.subjects : [...new Set(conversations.map(c => c.subject).filter(Boolean))]);
    
    const vocabularies = new Map();
    for (const subj of subjectsToAnalyze) {
      vocabularies.set(subj, await buildTopicVocabulary(subj, req.user.college || 'Parul University'));
    }

    const topicCounts = {};
    const subjectCounts = {};
    let totalValidQuestions = 0;

    for (const conv of conversations) {
      const subj = conv.subject || 'unknown';
      const vocab = vocabularies.get(subj) || new Map();
      
      // Process user messages in chronological order to track focusTopic for follow-ups
      let currentFocusTopic = null;
      
      for (const msg of conv.messages) {
        if (msg.role !== 'user' || !msg.content) continue;
        if (msg.kind !== 'normal') continue; // Skip greetings, permission offers, clarifications
        
        // Use the conversation's focusTopic for follow-ups, otherwise extract from message
        let questionTopic = null;
        const analysis = {
          isFollowUp: false,
          focusTopic: null,
        };
        
        // Simple follow-up detection: if message has no content words but has reference words
        const tokens = tokenize(msg.content);
        const contentWords = tokens.filter(t => !STOPWORDS.has(t) && !INSTRUCTION_WORDS.has(t) && !REFERENCE_WORDS.has(t));
        const hasRef = tokens.some(t => REFERENCE_WORDS.has(t));
        const isFollowUp = tokens.length > 0 && (hasRef || contentWords.length === 0);
        
        if (isFollowUp && conv.focusTopic) {
          questionTopic = conv.focusTopic;
        } else {
          questionTopic = matchTopic(msg.content, vocab);
        }
        
        // Fallback: if still no topic, use the conversation's focusTopic
        if (!questionTopic && conv.focusTopic) {
          questionTopic = conv.focusTopic;
        }
        
        const finalTopic = questionTopic || 'Unclassified';
        topicCounts[finalTopic] = (topicCounts[finalTopic] || 0) + 1;
        subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
        totalValidQuestions++;
      }
    }

    // Sort and limit top topics, excluding stoplisted words
    const stoplisted = new Set([...STOPWORDS, ...INSTRUCTION_WORDS, ...REFERENCE_WORDS, ...GENERIC_TOPIC_WORDS]);
    const topTopics = Object.entries(topicCounts)
      .filter(([topic]) => !stoplisted.has(normalizeText(topic)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic: capitalizeTopic(topic), count }));

    const bySubject = Object.entries(subjectCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([subject, count]) => ({ subject, count }));

    // Total questions = sum of subject counts (each question counted once)
    res.json({ insights: { topTopics, bySubject, totalQuestions: totalValidQuestions, periodDays: days } });
  } catch (error) {
    next(error);
  }
});

function capitalizeTopic(topic) {
  return topic
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Migration endpoint to clean existing aggregated data
router.post('/insights/migrate', authorize('admin'), async (req, res, next) => {
  try {
    // This would be run once to clean up old data
    // For now, just return the current state
    res.json({ message: 'Migration endpoint ready. Run with proper script.' });
  } catch (error) {
    next(error);
  }
});

export default router;
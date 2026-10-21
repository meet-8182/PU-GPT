import { Memory } from '../models/index.js';
import { Ollama } from 'ollama';
import { config } from '../config/index.js';

const ollama = new Ollama({ host: config.ollamaHost });

const MEMORY_EXTRACTION_MODEL = 'qwen2.5:3b-instruct-q4_K_M';
const MEMORY_EXTRACTION_THRESHOLD = 0.7;
const MAX_MEMORIES_PER_USER = 100;

const MEMORY_CATEGORIES = [
  'preference',
  'goal',
  'project',
  'fact',
  'style',
  'other',
];

const SENSITIVE_PATTERNS = [
  /password/i,
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /credential/i,
  /ssn|social.?security/i,
  /credit.?card/i,
  /bank.?account/i,
  /passport/i,
];

function containsSensitiveInfo(text) {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text));
}

function sanitizeMemoryContent(content) {
  let sanitized = content.trim();
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  return sanitized.slice(0, 2000);
}

async function extractMemoriesFromConversation(studentId, conversation, options = {}) {
  const { force = false } = options;
  
  if (!conversation.memoryEnabled && !force) {
    return [];
  }

  const messages = conversation.messages || [];
  if (messages.length < 3) {
    return [];
  }

  const lastExtracted = conversation.lastMemoryExtractedAt || conversation.createdAt;
  const newMessages = messages.filter(m => m.timestamp > lastExtracted);
  if (newMessages.length < 2 && !force) {
    return [];
  }

  const conversationText = messages
    .slice(-10)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const extractionPrompt = `You are a memory extraction assistant. Analyze this conversation and extract concise, useful facts about the student that would help personalize future responses.

Categories:
- preference: Learning preferences (e.g., "prefers visual explanations", "likes code examples")
- goal: Learning goals (e.g., "preparing for DSA interview", "wants to learn React")
- project: Project details (e.g., "building a todo app with React", "working on compiler project")
- fact: Explicitly stated facts (e.g., "I'm a 3rd year CSE student", "I know Python and Java")
- style: Communication style (e.g., "prefers short answers", "likes detailed explanations")
- other: Anything else relevant

Rules:
1. Only extract non-sensitive, useful information
2. No passwords, API keys, personal IDs, or secrets
3. Be concise - each memory should be one clear fact
4. Deduplicate - don't repeat similar memories
5. Return JSON array only

Conversation:
${conversationText}

Return format: [{"content": "fact", "category": "preference", "confidence": 0.9}]`;

  try {
    const response = await ollama.chat({
      model: MEMORY_EXTRACTION_MODEL,
      messages: [{ role: 'user', content: extractionPrompt }],
      options: {
        temperature: 0.1,
        num_predict: 1000,
        num_ctx: 4096,
      },
      stream: false,
    });

    const extracted = JSON.parse(response.message.content);
    const validMemories = [];

    for (const mem of extracted) {
      if (!mem.content || !MEMORY_CATEGORIES.includes(mem.category)) continue;
      if (containsSensitiveInfo(mem.content)) continue;
      
      validMemories.push({
        studentId,
        content: sanitizeMemoryContent(mem.content),
        category: mem.category,
        source: 'extracted',
        confidence: Math.min(Math.max(mem.confidence || 0.7, 0), 1),
        metadata: {
          conversationId: conversation._id,
          subject: conversation.subject,
          extractedAt: new Date(),
        },
      });
    }

    return validMemories;
  } catch (error) {
    console.error('[MemoryManager] Extraction error:', error.message);
    return [];
  }
}

async function saveOrUpdateMemories(studentId, memories) {
  const results = { created: 0, updated: 0, skipped: 0 };

  for (const mem of memories) {
    const existing = await Memory.findOne({
      studentId,
      content: { $regex: `^${escapeRegex(mem.content)}$`, $options: 'i' },
      isActive: true,
    });

    if (existing) {
      if (mem.confidence > existing.confidence) {
        existing.confidence = mem.confidence;
        existing.category = mem.category;
        existing.metadata = { ...existing.metadata, ...mem.metadata };
        existing.updatedAt = new Date();
        await existing.save();
        results.updated++;
      } else {
        results.skipped++;
      }
    } else {
      const count = await Memory.countDocuments({ studentId, isActive: true });
      if (count >= MAX_MEMORIES_PER_USER) {
        const oldest = await Memory.findOne({ studentId, isActive: true })
          .sort({ createdAt: 1 });
        if (oldest) {
          oldest.isActive = false;
          await oldest.save();
        }
      }

      await Memory.create(mem);
      results.created++;
    }
  }

  return results;
}

async function extractAndSaveMemories(studentId, conversation) {
  const { User } = await import('../models/index.js');
  
  // Check if memory is enabled for this user
  const user = await User.findById(studentId).select('memoryEnabled').lean();
  if (user?.memoryEnabled === false) {
    return { created: 0, updated: 0, skipped: 0 };
  }
  
  const memories = await extractMemoriesFromConversation(studentId, conversation);
  if (memories.length > 0) {
    return saveOrUpdateMemories(studentId, memories);
  }
  return { created: 0, updated: 0, skipped: 0 };
}

async function getRelevantMemories(studentId, query, options = {}) {
  const { limit = 10, categories, minConfidence = 0.5 } = options;

  const filter = {
    studentId,
    isActive: true,
    confidence: { $gte: minConfidence },
  };

  if (categories && categories.length > 0) {
    filter.category = { $in: categories };
  }

  let memories = await Memory.find(filter)
    .sort({ confidence: -1, updatedAt: -1 })
    .limit(limit * 2)
    .lean();

  if (query && memories.length > 0) {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    memories = memories.map(mem => {
      let relevance = mem.confidence;
      const contentLower = mem.content.toLowerCase();
      for (const word of queryWords) {
        if (contentLower.includes(word)) relevance += 0.1;
      }
      return { ...mem, relevance };
    }).sort((a, b) => b.relevance - a.relevance);
  }

  return memories.slice(0, limit);
}

async function getAllMemories(studentId, options = {}) {
  const { includeInactive = false, category } = options;

  const filter = { studentId };
  if (!includeInactive) filter.isActive = true;
  if (category) filter.category = category;

  return Memory.find(filter)
    .sort({ category: 1, updatedAt: -1 })
    .lean();
}

async function createExplicitMemory(studentId, { content, category = 'fact', confidence = 1.0 }) {
  const { User } = await import('../models/index.js');
  
  // Check if memory is enabled for this user
  const user = await User.findById(studentId).select('memoryEnabled').lean();
  if (user?.memoryEnabled === false) {
    throw new Error('Memory is disabled. Enable it in settings to add new memories.');
  }
  
  const sanitized = sanitizeMemoryContent(content);
  if (!sanitized) throw new Error('Memory content cannot be empty');
  if (containsSensitiveInfo(sanitized)) throw new Error('Cannot store sensitive information');

  const existing = await Memory.findOne({
    studentId,
    content: { $regex: `^${escapeRegex(sanitized)}$`, $options: 'i' },
    isActive: true,
  });

  if (existing) {
    existing.confidence = Math.max(existing.confidence, confidence);
    existing.category = category;
    existing.updatedAt = new Date();
    await existing.save();
    return existing;
  }

  const count = await Memory.countDocuments({ studentId, isActive: true });
  if (count >= MAX_MEMORIES_PER_USER) {
    const oldest = await Memory.findOne({ studentId, isActive: true })
      .sort({ createdAt: 1 });
    if (oldest) {
      oldest.isActive = false;
      await oldest.save();
    }
  }

  return Memory.create({
    studentId,
    content: sanitized,
    category,
    source: 'explicit',
    confidence,
  });
}

async function updateMemory(studentId, memoryId, updates) {
  const allowedUpdates = ['content', 'category', 'confidence', 'isActive'];
  const updateData = {};
  
  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      if (key === 'content') {
        const sanitized = sanitizeMemoryContent(updates[key]);
        if (containsSensitiveInfo(sanitized)) throw new Error('Cannot store sensitive information');
        updateData[key] = sanitized;
      } else {
        updateData[key] = updates[key];
      }
    }
  }

  updateData.updatedAt = new Date();

  const memory = await Memory.findOneAndUpdate(
    { _id: memoryId, studentId },
    updateData,
    { new: true }
  );

  if (!memory) throw new Error('Memory not found');
  return memory;
}

async function deleteMemory(studentId, memoryId) {
  const memory = await Memory.findOneAndDelete({ _id: memoryId, studentId });
  if (!memory) throw new Error('Memory not found');
  return { success: true };
}

async function clearAllMemories(studentId) {
  const result = await Memory.deleteMany({ studentId });
  return { deletedCount: result.deletedCount };
}

async function toggleMemoryEnabled(studentId, enabled) {
  const { User } = await import('../models/index.js');
  await User.findByIdAndUpdate(studentId, { memoryEnabled: enabled });
  // Also update existing memories' isActive to match (for backward compatibility)
  await Memory.updateMany({ studentId }, { isActive: enabled });
  return { success: true, enabled };
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export {
  extractMemoriesFromConversation,
  saveOrUpdateMemories,
  extractAndSaveMemories,
  getRelevantMemories,
  getAllMemories,
  createExplicitMemory,
  updateMemory,
  deleteMemory,
  clearAllMemories,
  toggleMemoryEnabled,
  MEMORY_CATEGORIES,
};
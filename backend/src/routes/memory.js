import { z } from 'zod';
import express from 'express';
import { Memory, User } from '../models/index.js';
import { requireAuth, authorize, validate, validateQuery, AppError } from '../middleware/index.js';
import {
  getAllMemories,
  createExplicitMemory,
  updateMemory,
  deleteMemory,
  clearAllMemories,
  toggleMemoryEnabled,
  getRelevantMemories,
  MEMORY_CATEGORIES,
} from '../services/memoryManager.js';

const router = express.Router();

router.use(requireAuth);

const createMemorySchema = z.object({
  content: z.string().min(1).max(2000),
  category: z.enum(MEMORY_CATEGORIES).default('fact'),
  confidence: z.number().min(0).max(1).default(1.0),
});

const updateMemorySchema = z.object({
  content: z.string().min(1).max(2000).optional(),
  category: z.enum(MEMORY_CATEGORIES).optional(),
  confidence: z.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
});

const queryMemorySchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(10),
  categories: z.array(z.enum(MEMORY_CATEGORIES)).optional(),
  minConfidence: z.coerce.number().min(0).max(1).default(0.5),
});

/**
 * GET /api/memory
 * Get all memories for the authenticated student
 */
router.get('/', authorize('student'), async (req, res, next) => {
  try {
    const { includeInactive, category } = req.query;
    const memories = await getAllMemories(req.user._id, {
      includeInactive: includeInactive === 'true',
      category,
    });
    
    // Get user's memory enabled status
    const user = await User.findById(req.user._id).select('memoryEnabled').lean();
    const memoryEnabled = user?.memoryEnabled !== false;
    
    res.json({ memories, memoryEnabled });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/relevant
 * Get memories relevant to a query
 */
router.get('/relevant', authorize('student'), validateQuery(queryMemorySchema), async (req, res, next) => {
  try {
    const { query, limit, categories, minConfidence } = req.query;
    const memories = await getRelevantMemories(req.user._id, query || '', {
      limit,
      categories,
      minConfidence,
    });
    res.json({ memories });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/memory
 * Create a new explicit memory
 */
router.post('/', authorize('student'), validate(createMemorySchema), async (req, res, next) => {
  try {
    const { content, category, confidence } = req.body;
    const memory = await createExplicitMemory(req.user._id, { content, category, confidence });
    res.status(201).json({ memory });
  } catch (error) {
    if (error.message === 'Cannot store sensitive information') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * PATCH /api/memory/:id
 * Update a memory
 */
router.patch('/:id', authorize('student'), validate(updateMemorySchema), async (req, res, next) => {
  try {
    const memory = await updateMemory(req.user._id, req.params.id, req.body);
    if (!memory) {
      throw new AppError('Memory not found', 404);
    }
    res.json({ memory });
  } catch (error) {
    if (error.message === 'Cannot store sensitive information') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * DELETE /api/memory/:id
 * Delete a memory
 */
router.delete('/:id', authorize('student'), async (req, res, next) => {
  try {
    await deleteMemory(req.user._id, req.params.id);
    res.json({ success: true });
  } catch (error) {
    if (error.message === 'Memory not found') {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * DELETE /api/memory
 * Clear all memories for the authenticated student
 */
router.delete('/', authorize('student'), validate(z.object({
  confirm: z.boolean().refine(v => v === true, 'Confirmation required'),
})), async (req, res, next) => {
  try {
    const result = await clearAllMemories(req.user._id);
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/memory/toggle
 * Enable/disable memory for the student
 */
router.patch('/toggle', authorize('student'), validate(z.object({
  enabled: z.boolean(),
})), async (req, res, next) => {
  try {
    const { enabled } = req.body;
    const result = await toggleMemoryEnabled(req.user._id, enabled);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/memory/categories
 * Get available memory categories
 */
router.get('/categories', authorize('student'), (req, res) => {
  res.json({ categories: MEMORY_CATEGORIES });
});

export default router;
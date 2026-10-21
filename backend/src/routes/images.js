import { z } from 'zod';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { GeneratedImage } from '../models/index.js';
import { Document } from '../models/index.js';
import { authenticate, authorize, validate, validateQuery, AppError } from '../middleware/index.js';
import { config } from '../config/index.js';
import { ocrRateLimit, generateRateLimit, historyRateLimit } from '../middleware/rateLimit.js';
import { validateImageFile, sanitizeFilename, safeDeleteFile, ensureDir } from '../utils/fileValidation.js';
import { validatePrompt } from '../utils/promptModeration.js';
import { extractText, checkOcrHealth } from '../services/ocrService.js';
import { generateImage, deleteGeneratedImage, checkImageGenHealth } from '../services/imageGenService.js';
import { addImageJob, getJobStatus, initImageQueue, getQueueStats } from '../services/imageQueue.js';
import { processDocumentWithText } from '../services/ingestion.js';
import fs from 'fs/promises';

const router = express.Router();

// Multer config for image uploads (OCR and document upload)
const imageStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const tempDir = path.join(config.uploadDir, 'temp');
    await ensureDir(tempDir);
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const imageFileFilter = (req, file, cb) => {
  const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PNG, JPEG, WebP, and PDF files are allowed', 400), false);
  }
};

const imageUpload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: config.maxImageUploadSize },
});

// Validation schemas
const generateSchema = z.object({
  prompt: z.string().min(1).max(2000),
  width: z.number().int().min(64).max(1024).optional(),
  height: z.number().int().min(64).max(1024).optional(),
  seed: z.number().int().optional(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
  status: z.enum(['queued', 'processing', 'done', 'failed']).optional(),
});

const ocrUploadSchema = z.object({
  subject: z.string().optional(), // For students: which subject to ask about
});

/**
 * Health check for image models
 * Public endpoint - no auth required
 */
router.get('/health', async (req, res, next) => {
  try {
    const [ocrHealth, genHealth] = await Promise.all([
      checkOcrHealth(),
      checkImageGenHealth(),
    ]);

    res.json({
      ocr: ocrHealth,
      imageGeneration: genHealth,
      queue: await getQueueStats(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/images/ocr
 * Extract text from uploaded image/PDF
 * Student, Teacher, Admin
 */
router.post('/ocr', authenticate, authorize('student', 'teacher', 'admin'), ocrRateLimit, imageUpload.single('file'), validate(ocrUploadSchema), async (req, res, next) => {
  let tempFilePath = null;

  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    tempFilePath = req.file.path;

    // Validate file with magic bytes
    const buffer = await fs.readFile(tempFilePath);
    await validateImageFile(buffer);

    // Extract text
    const result = await extractText(tempFilePath);

    res.json({
      text: result.text,
      pages: result.pages,
      durationMs: result.durationMs,
    });
  } catch (err) {
    next(err);
  } finally {
    // Cleanup temp file
    if (tempFilePath) {
      await safeDeleteFile(tempFilePath);
    }
  }
});

/**
 * POST /api/images/generate
 * Create image generation job
 * Student, Teacher, Admin
 */
router.post('/generate', authenticate, authorize('student', 'teacher', 'admin'), generateRateLimit, validate(generateSchema), async (req, res, next) => {
  try {
    const { prompt, width, height, seed } = req.body;

    // Validate and sanitize prompt
    const cleanPrompt = await validatePrompt(prompt);

    const w = width || config.defaultImageWidth;
    const h = height || config.defaultImageHeight;

    // Create image document with queued status
    const imageDoc = await GeneratedImage.create({
      userId: req.user._id,
      prompt: cleanPrompt,
      width: w,
      height: h,
      seed,
      filePath: '', // Will be filled on completion
      fileName: '',
      fileSize: 0,
      status: 'queued',
    });

    // Add to queue
    const jobId = await addImageJob(imageDoc._id.toString());

    // Update with job ID for tracking
    imageDoc.jobId = jobId;
    await imageDoc.save();

    res.status(202).json({
      jobId,
      imageId: imageDoc._id,
      status: 'queued',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/images/jobs/:id
 * Get job status (owner or admin)
 */
router.get('/jobs/:id', authenticate, async (req, res, next) => {
  try {
    const imageDoc = await GeneratedImage.findById(req.params.id);
    if (!imageDoc) {
      throw new AppError('Image not found', 404);
    }

    // Check ownership
    if (req.user.role !== 'admin' && imageDoc.userId.toString() !== req.user._id.toString()) {
      throw new AppError('Not authorized to view this job', 403);
    }

    // Get queue status if still processing
    let queueStatus = null;
    if (imageDoc.jobId && (imageDoc.status === 'queued' || imageDoc.status === 'processing')) {
      queueStatus = await getJobStatus(imageDoc.jobId);
    }

    let imageUrl = null;
    if (imageDoc.status === 'done' && imageDoc.filePath) {
      imageUrl = `/api/images/file/${imageDoc._id}`;
    }

    res.json({
      imageId: imageDoc._id,
      prompt: imageDoc.prompt,
      width: imageDoc.width,
      height: imageDoc.height,
      seed: imageDoc.seed,
      status: imageDoc.status,
      error: imageDoc.error,
      imageUrl,
      queueStatus,
      createdAt: imageDoc.createdAt,
      updatedAt: imageDoc.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/images/history
 * Paginated list of user's generated images
 */
router.get('/history', authenticate, authorize('student', 'teacher', 'admin'), historyRateLimit, validateQuery(historyQuerySchema), async (req, res, next) => {
  try {
    const { page, limit, status } = req.query;
    const filter = { userId: req.user._id };
    if (status) filter.status = status;

    const [images, total] = await Promise.all([
      GeneratedImage.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      GeneratedImage.countDocuments(filter),
    ]);

    res.json({
      images: images.map(img => ({
        id: img._id,
        prompt: img.prompt,
        width: img.width,
        height: img.height,
        seed: img.seed,
        status: img.status,
        error: img.error,
        fileName: img.fileName,
        fileSize: img.fileSize,
        imageUrl: img.status === 'done' ? `/api/images/file/${img._id}` : null,
        createdAt: img.createdAt,
        updatedAt: img.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/images/file/:id
 * Serve generated image file (auth required)
 */
router.get('/file/:id', authenticate, async (req, res, next) => {
  try {
    const imageDoc = await GeneratedImage.findById(req.params.id);
    if (!imageDoc) {
      throw new AppError('Image not found', 404);
    }

    // Check ownership
    if (req.user.role !== 'admin' && imageDoc.userId.toString() !== req.user._id.toString()) {
      throw new AppError('Not authorized to access this image', 403);
    }

    if (imageDoc.status !== 'done' || !imageDoc.filePath) {
      throw new AppError('Image not ready', 404);
    }

    // Verify file exists
    try {
      await fs.access(imageDoc.filePath);
    } catch {
      throw new AppError('Image file not found on disk', 404);
    }

    res.sendFile(path.resolve(imageDoc.filePath), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': `inline; filename="${imageDoc.fileName}"`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/images/:id
 * Delete generated image (owner or admin)
 */
router.delete('/:id', authenticate, authorize('student', 'teacher', 'admin'), async (req, res, next) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role !== 'admin') {
      filter.userId = req.user._id;
    }

    const imageDoc = await GeneratedImage.findOneAndDelete(filter);
    if (!imageDoc) {
      throw new AppError('Image not found', 404);
    }

    // Delete file from disk
    if (imageDoc.filePath) {
      await deleteGeneratedImage(imageDoc.filePath);
    }

    res.json({ message: 'Image deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  UniversityInfo,
  UniversityInfoSettings,
  UniversityInfoAudit,
  INFO_CATEGORIES,
} from '../models/index.js';
import {
  requireAuth,
  authorize,
  AppError,
} from '../middleware/index.js';
import { config } from '../config/index.js';
import { extractTextFromFile } from '../services/ingestion.js';
import { extractText as extractImageText } from '../services/ocrService.js';
import {
  indexUniversityInfo,
  deleteUniversityInfoChunks,
  reindexUniversityInfo,
  getUniversityInfoChunks,
  hashBuffer,
  hashString,
  detectPoorTableExtraction,
} from '../services/puInfo.js';
import { safeDeleteFile } from '../utils/fileValidation.js';

const router = express.Router();

router.use(requireAuth, authorize('admin'));

const INFO_UPLOAD_DIR = path.join(config.uploadDir, 'university-info');
fsSync.mkdirSync(INFO_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INFO_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
];

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    return cb(new AppError('Only PDF, DOCX, TXT, PNG, JPEG and WebP files are allowed', 400), false);
  },
});

const categorySchema = z.enum(INFO_CATEGORIES);

const uploadSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: categorySchema,
  effectiveFrom: z.string().min(1),
  validUntil: z.string().optional().or(z.literal('')),
});

const quickFactSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: categorySchema,
  content: z.string().trim().min(1).max(20000),
  effectiveFrom: z.string().min(1),
  validUntil: z.string().optional().or(z.literal('')),
});

const settingsSchema = z.object({
  contactBlock: z.string().trim().min(1).max(5000),
  disclaimer: z.string().trim().min(1).max(2000),
});

function parseDate(value, field, { required = false } = {}) {
  if (!value) {
    if (required) throw new AppError(`${field} is required`, 400);
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(`${field} is not a valid date`, 400);
  return date;
}

function validateWindow(effectiveFrom, validUntil) {
  if (validUntil && validUntil < effectiveFrom) {
    throw new AppError('validUntil must be on or after effectiveFrom', 400);
  }
}

function parseUploadFields(body) {
  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      'Title, category and effectiveFrom are required. Category must be one of: ' + INFO_CATEGORIES.join(', '),
      400
    );
  }
  const effectiveFrom = parseDate(parsed.data.effectiveFrom, 'effectiveFrom', { required: true });
  const validUntil = parseDate(parsed.data.validUntil, 'validUntil');
  validateWindow(effectiveFrom, validUntil);
  return { ...parsed.data, effectiveFrom, validUntil };
}

async function extractFromUpload(file) {
  if (file.mimetype.startsWith('image/')) {
    const result = await extractImageText(file.path, file.mimetype);
    return { text: result.text, pageTexts: [{ page: 1, text: result.text }] };
  }
  return extractTextFromFile(file.path, file.mimetype);
}

async function audit(action, req, document, details = {}) {
  try {
    await UniversityInfoAudit.create({
      action,
      documentId: document?._id,
      documentTitle: document?.title,
      actorId: req.user?._id,
      actorEmail: req.user?.email,
      details,
    });
  } catch (error) {
    console.error('[UniversityInfo] Failed to write audit log:', error.message);
  }
}

function serialize(doc) {
  if (!doc) return null;
  const value = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...value,
    id: value._id,
    // Never expose stored file paths to the browser.
    fileUrl: undefined,
  };
}

function nextVersionFor(title) {
  return UniversityInfo.findOne({ title }).sort({ version: -1 }).select('version').lean()
    .then((latest) => (latest?.version || 0) + 1)
    .catch(() => 1);
}

// POST /api/admin/university-info/upload
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('A PDF, DOCX, TXT or image file is required', 400);
    const fields = parseUploadFields(req.body);

    const fileHash = hashBuffer(await fs.readFile(req.file.path));
    const duplicate = await UniversityInfo.findOne({
      fileHash,
      status: { $ne: 'superseded' },
    }).lean();
    if (duplicate) {
      await safeDeleteFile(req.file.path);
      return res.status(409).json({
        error: 'This document has already been uploaded.',
        code: 'DUPLICATE_DOCUMENT',
        documentId: duplicate._id,
      });
    }

    const { text, pageTexts } = await extractFromUpload(req.file);
    if (!text || text.trim().length < 20) {
      await safeDeleteFile(req.file.path);
      throw new AppError('Could not extract enough text from this file', 422);
    }

    const warnings = [];
    const tableWarning = detectPoorTableExtraction(text);
    if (tableWarning) warnings.push(tableWarning);

    const document = await UniversityInfo.create({
      title: fields.title,
      category: fields.category,
      version: await nextVersionFor(fields.title),
      effectiveFrom: fields.effectiveFrom,
      validUntil: fields.validUntil,
      lastReviewed: new Date(),
      approved: false,
      status: 'draft',
      sourceDoc: req.file.originalname,
      fileUrl: req.file.path,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      fileHash,
      text,
      contentHash: hashString(text),
      warnings,
      uploadedBy: req.user._id,
    });

    let indexWarning = null;
    try {
      await indexUniversityInfo(document, { text, pageTexts });
    } catch (error) {
      console.error('[UniversityInfo] Indexing failed for', document._id.toString(), error.message);
      indexWarning = error.message;
    }

    await audit('upload', req, document, { category: fields.category, version: document.version });
    const fresh = await UniversityInfo.findById(document._id).lean();
    res.status(201).json({ document: serialize(fresh), warning: indexWarning });
  } catch (error) {
    if (req.file) await safeDeleteFile(req.file.path);
    next(error);
  }
});

// POST /api/admin/university-info/quick-fact
router.post('/quick-fact', async (req, res, next) => {
  try {
    const parsed = quickFactSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Title, category, content and effectiveFrom are required', 400);
    }
    const effectiveFrom = parseDate(parsed.data.effectiveFrom, 'effectiveFrom', { required: true });
    const validUntil = parseDate(parsed.data.validUntil, 'validUntil');
    validateWindow(effectiveFrom, validUntil);

    const document = await UniversityInfo.create({
      title: parsed.data.title,
      category: parsed.data.category,
      version: await nextVersionFor(parsed.data.title),
      effectiveFrom,
      validUntil,
      lastReviewed: new Date(),
      approved: true,
      status: 'approved',
      sourceDoc: `Quick fact: ${parsed.data.title}`,
      text: parsed.data.content,
      contentHash: hashString(parsed.data.content),
      isQuickFact: true,
      uploadedBy: req.user._id,
      approvedBy: req.user._id,
      approvedAt: new Date(),
    });

    try {
      await indexUniversityInfo(document, { text: parsed.data.content });
    } catch (error) {
      await UniversityInfo.findByIdAndUpdate(document._id, {
        approved: false,
        status: 'draft',
        errorMessage: error.message,
      });
      throw new AppError(`Quick fact saved as a draft but indexing failed: ${error.message}`, 502);
    }

    await audit('quick-fact', req, document, { category: parsed.data.category });
    const fresh = await UniversityInfo.findById(document._id).lean();
    res.status(201).json({ document: serialize(fresh) });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/university-info
router.get('/', async (req, res, next) => {
  try {
    const { category, status, page = '1', limit = '50' } = req.query;
    const filter = {};
    if (category && INFO_CATEGORIES.includes(category)) filter.category = category;
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const [documents, total] = await Promise.all([
      UniversityInfo.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('uploadedBy', 'name email')
        .populate('approvedBy', 'name email')
        .lean(),
      UniversityInfo.countDocuments(filter),
    ]);

    res.json({
      documents: documents.map(serialize),
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/university-info/audit
router.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const entries = await UniversityInfoAudit.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/university-info/settings
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await UniversityInfoSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { key: 'default' } },
      { upsert: true, new: true }
    ).lean();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

// PUT /api/admin/university-info/settings
router.put('/settings', async (req, res, next) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('contactBlock and disclaimer are required', 400);
    }
    const settings = await UniversityInfoSettings.findOneAndUpdate(
      { key: 'default' },
      { ...parsed.data, updatedBy: req.user._id, updatedAt: new Date() },
      { upsert: true, new: true }
    ).lean();
    await audit('settings', req, null, { fields: ['contactBlock', 'disclaimer'] });
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/university-info/preview?includeDraft=true
router.get('/preview', async (req, res, next) => {
  try {
    const includeDraft = String(req.query.includeDraft || 'true') !== 'false';
    const statuses = includeDraft ? ['approved', 'draft'] : ['approved'];
    const documents = await UniversityInfo.find({ status: { $in: statuses } })
      .sort({ category: 1, createdAt: -1 })
      .limit(20)
      .lean();

    const preview = [];
    for (const document of documents) {
      let chunks = [];
      try {
        chunks = await getUniversityInfoChunks(document._id);
      } catch (error) {
        chunks = [];
      }
      preview.push({
        ...serialize(document),
        visibleToVisitors: document.approved === true && document.status === 'approved',
        chunks: chunks.slice(0, 20).map((chunk) => ({
          text: chunk.text,
          heading: chunk.metadata?.heading || '',
          page: chunk.metadata?.page || 1,
        })),
      });
    }

    res.json({ documents: preview });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/university-info/:id/approve
router.post('/:id/approve', async (req, res, next) => {
  try {
    const document = await UniversityInfo.findById(req.params.id);
    if (!document) throw new AppError('Document not found', 404);
    if (document.status === 'superseded') {
      throw new AppError('A superseded document cannot be approved', 409);
    }

    document.approved = true;
    document.status = 'approved';
    document.approvedBy = req.user._id;
    document.approvedAt = new Date();
    document.lastReviewed = new Date();
    await document.save();

    try {
      await reindexUniversityInfo(document);
    } catch (error) {
      document.approved = false;
      document.status = 'draft';
      document.errorMessage = error.message;
      await document.save();
      throw new AppError(`Approval failed while indexing: ${error.message}`, 502);
    }

    await audit('approve', req, document);
    res.json({ document: serialize(document) });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/university-info/:id/unapprove
router.post('/:id/unapprove', async (req, res, next) => {
  try {
    const document = await UniversityInfo.findById(req.params.id);
    if (!document) throw new AppError('Document not found', 404);

    // Remove chunks first so the document is immediately unretrievable even if
    // re-indexing fails afterwards.
    await deleteUniversityInfoChunks(document._id);

    document.approved = false;
    document.status = 'draft';
    document.approvedBy = undefined;
    document.approvedAt = undefined;
    await document.save();

    try {
      await reindexUniversityInfo(document);
    } catch (error) {
      console.error('[UniversityInfo] Reindex after unapprove failed:', error.message);
    }

    await audit('unapprove', req, document);
    res.json({ document: serialize(document) });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/university-info/:id/replace (multipart, new version)
router.post('/:id/replace', upload.single('file'), async (req, res, next) => {
  try {
    const oldDocument = await UniversityInfo.findById(req.params.id);
    if (!oldDocument) throw new AppError('Document not found', 404);
    if (!req.file) throw new AppError('A replacement file is required', 400);

    const fields = parseUploadFields({
      title: req.body.title || oldDocument.title,
      category: req.body.category || oldDocument.category,
      effectiveFrom: req.body.effectiveFrom || new Date().toISOString().slice(0, 10),
      validUntil: req.body.validUntil || '',
    });

    const fileHash = hashBuffer(await fs.readFile(req.file.path));
    const duplicate = await UniversityInfo.findOne({
      fileHash,
      status: { $ne: 'superseded' },
    }).lean();
    if (duplicate) {
      await safeDeleteFile(req.file.path);
      return res.status(409).json({
        error: 'This replacement file is identical to an existing document.',
        code: 'DUPLICATE_DOCUMENT',
        documentId: duplicate._id,
      });
    }

    const { text, pageTexts } = await extractFromUpload(req.file);
    if (!text || text.trim().length < 20) {
      await safeDeleteFile(req.file.path);
      throw new AppError('Could not extract enough text from this file', 422);
    }

    const warnings = [];
    const tableWarning = detectPoorTableExtraction(text);
    if (tableWarning) warnings.push(tableWarning);

    const replacement = await UniversityInfo.create({
      title: fields.title,
      category: fields.category,
      version: (oldDocument.version || 1) + 1,
      effectiveFrom: fields.effectiveFrom,
      validUntil: fields.validUntil,
      lastReviewed: new Date(),
      approved: false,
      status: 'draft',
      sourceDoc: req.file.originalname,
      fileUrl: req.file.path,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
      fileHash,
      text,
      contentHash: hashString(text),
      warnings,
      replaces: oldDocument._id,
      uploadedBy: req.user._id,
    });

    try {
      await indexUniversityInfo(replacement, { text, pageTexts });
    } catch (error) {
      await UniversityInfo.findByIdAndUpdate(replacement._id, {
        status: 'draft',
        errorMessage: error.message,
      });
      throw new AppError(`Replacement saved as a draft but indexing failed: ${error.message}`, 502);
    }

    // Only after the replacement is indexed do we retire the old version.
    await deleteUniversityInfoChunks(oldDocument._id);
    oldDocument.status = 'superseded';
    oldDocument.approved = false;
    oldDocument.supersededBy = replacement._id;
    await oldDocument.save();

    await audit('replace', req, replacement, {
      replaces: oldDocument._id,
      previousVersion: oldDocument.version,
      version: replacement.version,
    });
    const fresh = await UniversityInfo.findById(replacement._id).lean();
    res.status(201).json({ document: serialize(fresh) });
  } catch (error) {
    if (req.file) await safeDeleteFile(req.file.path);
    next(error);
  }
});

// POST /api/admin/university-info/:id/reprocess
router.post('/:id/reprocess', async (req, res, next) => {
  try {
    const document = await UniversityInfo.findById(req.params.id);
    if (!document) throw new AppError('Document not found', 404);

    let text = document.text;
    let pageTexts = null;

    if (!text && document.fileUrl) {
      try {
        const extracted = await extractTextFromFile(document.fileUrl, document.fileType);
        text = extracted.text;
        pageTexts = extracted.pageTexts;
      } catch (error) {
        throw new AppError(`Could not re-read the source file: ${error.message}`, 422);
      }
    }
    if (!text) throw new AppError('No stored text is available to reprocess', 422);

    const tableWarning = detectPoorTableExtraction(text);
    const warnings = tableWarning ? [tableWarning] : [];

    await indexUniversityInfo(document, { text, pageTexts });
    document.text = text;
    document.warnings = warnings;
    document.contentHash = hashString(text);
    await document.save();

    await audit('reprocess', req, document);
    const fresh = await UniversityInfo.findById(document._id).lean();
    res.json({ document: serialize(fresh) });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/university-info/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const document = await UniversityInfo.findById(req.params.id);
    if (!document) throw new AppError('Document not found', 404);

    await deleteUniversityInfoChunks(document._id);
    if (document.fileUrl) await safeDeleteFile(document.fileUrl);
    await UniversityInfo.findByIdAndDelete(document._id);

    await audit('delete', req, document);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;

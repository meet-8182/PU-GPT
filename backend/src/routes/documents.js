import { z } from 'zod';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Document } from '../models/index.js';
import {
  requireAuth,
  authorize,
  validate,
  validateQuery,
  validateParams,
  AppError,
} from '../middleware/index.js';
import { config } from '../config/index.js';
import { processDocument, processDocumentWithText, deleteDocumentChunks } from '../services/ingestion.js';
import { extractText } from '../services/ocrService.js';
import { safeDeleteFile } from '../utils/fileValidation.js';
import fs from 'fs/promises';

const router = express.Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');

// Every document route requires authentication. Role checks stay per-route.
router.use(requireAuth);

// Storage for document uploads (teacher/admin)
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

// Extended file filter to include images for OCR
const docFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/webp',
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('Only PDF, DOCX, TXT, PNG, JPEG, and WebP files are allowed', 400), false);
  }
};

const docUpload = multer({
  storage: docStorage,
  fileFilter: docFileFilter,
  limits: { fileSize: config.maxFileSize },
});

const uploadSchema = z.object({
  college: z.string().min(1),
  department: z.string().min(1),
  subject: z.string().min(1),
  semester: z.string().min(1),
  unit: z.string().optional().or(z.literal('')).transform(v => v === '' ? undefined : v),
});

const querySchema = z.object({
  department: z.string().optional().or(z.literal('')),
  subject: z.string().optional().or(z.literal('')),
  semester: z.string().optional().or(z.literal('')),
  status: z.enum(['processing', 'indexed', 'failed']).optional().or(z.literal('')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
}).transform(d => ({
  ...d,
  department: d.department === '' ? undefined : d.department,
  subject: d.subject === '' ? undefined : d.subject,
  semester: d.semester === '' ? undefined : d.semester,
  status: d.status === '' ? undefined : d.status,
}));

/**
 * Check if PDF is scanned (image-based) by trying to extract text
 * Returns true if PDF appears to be scanned (little/no extractable text)
 */
async function isScannedPDF(filePath) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    const text = data.text?.trim() || '';
    // If less than 100 chars of text for the whole PDF, likely scanned
    return text.length < 100;
  } catch {
    // If pdf-parse fails, assume it might be scanned
    return true;
  }
}

/**
 * Process image/PDF with OCR and ingest
 */
async function processDocumentWithOCR(documentId, filePath, fileType, subject) {
  let document = await Document.findById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  try {
    // Extract text via OCR - pass file path (ocrService handles both buffer and path)
    const ocrResult = await extractText(filePath);

    if (!ocrResult.text || ocrResult.text.trim().length < 10) {
      throw new Error('OCR extracted insufficient text');
    }

    // Ingest the extracted text using existing pipeline
    await processDocumentWithText(documentId, ocrResult.text);

    // Update document with OCR metadata
    document = await Document.findById(documentId);
    document.ocrPages = ocrResult.pages?.length || 1;
    document.ocrDurationMs = ocrResult.durationMs;
    await document.save();

    console.log(`Document ${documentId} OCR processed and indexed with ${document.chunkCount} chunks`);
  } catch (error) {
    document.status = 'failed';
    document.errorMessage = `OCR processing failed: ${error.message}`;
    await document.save();
    throw error;
  }
}

router.post('/upload', authorize('teacher', 'admin'), docUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      await safeDeleteFile(req.file.path);
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
      });
    }

    const { college, department, subject, semester, unit } = parsed.data;

    // Check if teacher has access to this subject
    if (req.user.role === 'teacher' && !(req.user.subjects || []).includes(subject)) {
      await safeDeleteFile(req.file.path);
      throw new AppError('You do not have permission to upload to this subject', 403);
    }

    const filePath = req.file.path;
    const fileType = req.file.mimetype;
    const originalName = req.file.originalname;

    // Determine if file needs OCR (image or scanned PDF)
    const needsOCR = fileType.startsWith('image/') ||
      (fileType === 'application/pdf' && await isScannedPDF(filePath));

    const document = await Document.create({
      title: originalName,
      uploadedBy: req.user._id,
      college,
      department,
      subject,
      semester,
      unit,
      fileUrl: filePath,
      fileType,
      fileSize: req.file.size,
      status: needsOCR ? 'ocr_processing' : 'processing',
      needsOCR: needsOCR,
    });

    // Process asynchronously
    const processPromise = needsOCR
      ? processDocumentWithOCR(document._id, filePath, fileType, subject)
      : processDocument(document._id);

    processPromise
      .then(() => console.log('Document processed:', document._id))
      .catch(async (err) => {
        console.error('Document processing failed:', err);
        await Document.findByIdAndUpdate(document._id, {
          status: 'failed',
          errorMessage: err.message || 'Processing failed',
        });
      });

    res.status(201).json({
      document: {
        id: document._id,
        title: document.title,
        department: document.department,
        subject: document.subject,
        semester: document.semester,
        unit: document.unit,
        status: document.status,
        needsOCR: document.needsOCR,
        uploadedAt: document.uploadedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Debug endpoints are opt-in (ENABLE_DEBUG_ROUTES) and restricted to admins.
// They are disabled by default in production.
if (config.enableDebugRoutes) {
  router.post('/debug/process/:id', authorize('admin'), validateParams(z.object({ id: objectIdSchema })), async (req, res, next) => {
    try {
      const document = await Document.findById(req.params.id);
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }

      console.log('=== MANUAL PROCESS START ===', document.title);
      console.log('fileUrl:', document.fileUrl);
      console.log('fileType:', document.fileType);
      console.log('needsOCR:', document.needsOCR);

      let result;
      if (document.fileUrl === 'teacher-response') {
        console.log('Using processDocumentWithText - but need original text');
        document.status = 'failed';
        document.errorMessage = 'Cannot reprocess teacher-generated content without original response text';
        await document.save();
        return res.json({ success: false, message: 'Cannot reprocess teacher-generated content without original text' });
      } else {
        // Delete old vectors first
        await deleteDocumentChunks(document._id);

        if (document.needsOCR) {
          result = await processDocumentWithOCR(document._id, document.fileUrl, document.fileType, document.subject);
        } else {
          result = await processDocument(document._id);
        }
      }

      console.log('=== MANUAL PROCESS END ===', 'success');
      const updated = await Document.findById(req.params.id);
      res.json({ success: true, document: updated });
    } catch (err) {
      console.error('=== MANUAL PROCESS ERROR ===', err);
      // Never return stack traces to the client.
      next(new AppError('Document processing failed', 500));
    }
  });

  // Bulk reprocess all failed/processing documents
  router.post('/debug/reprocess-all', authorize('admin'), async (req, res, next) => {
    try {
      const documents = await Document.find({
        status: { $in: ['processing', 'failed', 'ocr_processing'] },
        fileUrl: { $ne: 'teacher-response' }
      }).select('_id title needsOCR fileUrl fileType subject');

      console.log(`Found ${documents.length} documents to reprocess`);

      const results = [];
      for (const doc of documents) {
        try {
          console.log(`Reprocessing: ${doc.title}`);
          await deleteDocumentChunks(doc._id);

          if (doc.needsOCR) {
            await processDocumentWithOCR(doc._id, doc.fileUrl, doc.fileType, doc.subject);
          } else {
            await processDocument(doc._id);
          }

          results.push({ id: doc._id, title: doc.title, success: true });
        } catch (err) {
          console.error(`Failed to reprocess ${doc.title}:`, err.message);
          results.push({ id: doc._id, title: doc.title, success: false, error: 'Processing failed' });
        }
      }

      res.json({ processed: results.length, results });
    } catch (err) {
      console.error('BULK REPROCESS ERROR:', err);
      next(new AppError('Bulk reprocessing failed', 500));
    }
  });
}

router.get('/', authorize('teacher', 'admin'), validateQuery(querySchema), async (req, res, next) => {
  try {
    const { department, subject, semester, status, page, limit } = req.query;
    const filter = {};

    if (req.user.role === 'teacher') {
      filter.uploadedBy = req.user._id;
    }
    if (department) filter.department = department;
    if (subject) filter.subject = subject;
    if (semester) filter.semester = semester;
    if (status) filter.status = status;

    const [documents, total] = await Promise.all([
      Document.find(filter)
        .sort({ uploadedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Document.countDocuments(filter),
    ]);

    res.json({
      documents: documents.map(d => ({
        id: d._id,
        title: d.title,
        department: d.department,
        subject: d.subject,
        semester: d.semester,
        unit: d.unit,
        status: d.status,
        needsOCR: d.needsOCR,
        chunkCount: d.chunkCount,
        errorMessage: d.errorMessage,
        uploadedAt: d.uploadedAt,
        indexedAt: d.indexedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/subjects', authorize('teacher', 'admin'), async (req, res, next) => {
  try {
    const filter = req.user.role === 'teacher' ? { uploadedBy: req.user._id } : {};
    const subjects = await Document.distinct('subject', filter);
    res.json({ subjects });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authorize('teacher', 'admin'), validateParams(z.object({ id: objectIdSchema })), async (req, res, next) => {
  try {
    const filter = { _id: req.params.id };
    if (req.user.role === 'teacher') {
      filter.uploadedBy = req.user._id;
    }

    const document = await Document.findOneAndDelete(filter);
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ message: 'Document deleted' });
  } catch (error) {
    next(error);
  }
});

export default router;
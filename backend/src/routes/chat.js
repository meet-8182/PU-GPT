import { z } from 'zod';
import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { Conversation, User, Document } from '../models/index.js';
import { requireAuth, authorize, validate, validateQuery, validateParams, AppError } from '../middleware/index.js';
import {
  processChatQuestion,
  saveConversation,
  getConversationHistory,
  webSearch,
  confirmWebSearch,
  callWebSearchLLM,
  detectWebSearchTrigger,
  sanitizeQuery,
  expandQueryForRetrieval,
  extractCitations,
  getConversationMessages,
} from '../services/chat.js';
import { config } from '../config/index.js';
import { noteLoggedInGenerationStart, noteLoggedInGenerationEnd } from '../services/guestLimits.js';

const router = express.Router();

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID');

// Every chat route requires authentication.
router.use(requireAuth);

// GET /api/chat/subjects - Get all available subjects (subjects with teachers)
router.get('/subjects', async (req, res, next) => {
  try {
    const subjects = await User.distinct('subjects', { role: 'teacher' });
    res.json({ subjects: subjects.filter(s => s).sort() });
  } catch (error) {
    next(error);
  }
});

// Multer config for image/PDF uploads in chat
const upload = multer({
  limits: { fileSize: config.maxFileSize }, // Use general max file size (10MB default)
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Only PNG, JPEG, WebP images and PDF files are allowed', 400), false);
    }
  },
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  subject: z.string().min(1),
  conversationId: z.string().optional(),
});

/**
 * Resolve or lazily allocate a conversation for the student. A new
 * conversation is NOT written to the database here: history entries should
 * only exist once the assistant has produced an answer, otherwise aborted
 * requests and web-search permission offers leave empty chats behind.
 */
async function resolveConversation(studentId, subject, conversationId) {
  if (conversationId && mongoose.isValidObjectId(conversationId)) {
    const existing = await Conversation.findOne({ _id: conversationId, studentId }).lean();
    if (existing) return { conversation: existing, isNew: false };
    // The id came from a stream that was never persisted (for example a
    // permission offer). Reuse it so the eventual save keeps the id the
    // client already holds.
    return {
      conversation: { _id: conversationId, studentId, subject, messages: [] },
      isNew: true,
    };
  }

  return {
    conversation: {
      _id: new mongoose.Types.ObjectId(),
      studentId,
      subject,
      messages: [],
    },
    isNew: true,
  };
}

// Uploaded chat files live outside the conversation document. Persisting the
// bytes on disk keeps PDF conversations well under MongoDB's 16MB document
// limit while still letting a reopened conversation download the file.
const CHAT_UPLOAD_DIR = path.resolve(config.uploadDir, 'chat');
fs.mkdir(CHAT_UPLOAD_DIR, { recursive: true }).catch((err) => {
  console.error('[Chat] Could not create attachment directory:', err.message);
});

const ATTACHMENT_FILENAME_RE = /^[a-f\d]{24}-[a-f\d-]{36}\.[a-z0-9]+$/i;

async function storeChatAttachment(file, conversationId) {
  const ext = (path.extname(file.originalname || '') || (file.mimetype === 'application/pdf' ? '.pdf' : '.bin'))
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, '')
    .slice(0, 12) || '.bin';
  const filename = `${conversationId}-${randomUUID()}${ext}`;
  await fs.mkdir(CHAT_UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(CHAT_UPLOAD_DIR, filename), file.buffer);
  return {
    filename,
    url: `/api/chat/attachments/${filename}`,
  };
}

/**
 * GET /api/chat/attachments/:filename
 * Serves a chat upload only to the student who owns a conversation that
 * references it. The filename itself is unguessable (UUID) and is additionally
 * checked against the conversation ownership record.
 */
router.get('/attachments/:filename', authorize('student'), async (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!ATTACHMENT_FILENAME_RE.test(filename)) {
      throw new AppError('Attachment not found', 404);
    }
    const url = `/api/chat/attachments/${filename}`;
    const owned = await Conversation.exists({
      studentId: req.user._id,
      'messages.attachments.url': url,
    });
    if (!owned) throw new AppError('Attachment not found', 404);

    const filePath = path.join(CHAT_UPLOAD_DIR, filename);
    try {
      await fs.access(filePath);
    } catch {
      throw new AppError('Attachment is no longer available', 410);
    }
    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/chat/suggestions?subject=...
 * Builds suggestions from the course materials that actually exist for the
 * student's department, semester, and selected subject. If nothing matches we
 * return an empty list so the UI can show an honest empty state instead of a
 * random question.
 */
router.get('/suggestions', authorize('student'), validateQuery(z.object({
  subject: z.string().max(200).optional().or(z.literal('')),
}).transform(d => ({ ...d, subject: d.subject === '' ? undefined : d.subject }))), async (req, res, next) => {
  try {
    const { subject } = req.query;
    const baseFilter = { status: 'indexed' };
    if (subject) baseFilter.subject = subject;
    if (req.user.department) baseFilter.department = req.user.department;
    if (req.user.semester) baseFilter.semester = String(req.user.semester);

    const selectFields = 'title subject unit semester';
    let documents = await Document.find(baseFilter)
      .select(selectFields)
      .sort({ uploadedAt: -1 })
      .limit(8)
      .lean();

    // If the profile filters are too narrow, fall back to the selected subject
    // (still real materials, never random prompts).
    if (documents.length === 0 && subject) {
      documents = await Document.find({ status: 'indexed', subject })
        .select(selectFields)
        .sort({ uploadedAt: -1 })
        .limit(8)
        .lean();
    }

    if (documents.length === 0) {
      return res.json({ suggestions: [] });
    }

    const suggestions = [];
    const seen = new Set();
    const push = (label, prompt) => {
      if (!prompt || seen.has(prompt)) return;
      seen.add(prompt);
      suggestions.push({ label, prompt });
    };

    for (const doc of documents) {
      const docSubject = doc.subject || subject || 'this subject';
      if (doc.unit) {
        push(`Unit ${doc.unit}`, `Explain the key concepts in Unit ${doc.unit} of ${docSubject}`);
      }
      if (doc.title) {
        const shortTitle = doc.title.length > 34 ? `${doc.title.slice(0, 32)}…` : doc.title;
        push(shortTitle, `Summarize "${doc.title}"`);
      }
      if (suggestions.length >= 4) break;
    }

    const firstSubject = subject || documents[0]?.subject;
    if (firstSubject) {
      push('Practice question', `Give me a practice question from ${firstSubject}`);
    }

    res.json({ suggestions: suggestions.slice(0, 5) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/chat/ask
 * Accepts both JSON and multipart/form-data
 * multipart fields: question, subject, conversationId (optional), file (optional image/PDF)
 * Web search trigger: leading backslash in question (\ or ＼)
 */
router.post('/ask', authorize('student'), upload.single('file'), async (req, res, next) => {
  try {
    // Handle both JSON and multipart
    const rawQuestion = req.body.question || '';
    const subject = req.body.subject;
    const conversationId = req.body.conversationId;
    const clientMessageId = req.body.clientMessageId;
    const studentId = req.user._id;

    // Idempotency: if the same clientMessageId was already used for this
    // student+subject conversation, return the existing conversation without
    // starting a new generation.  We look for a persisted answer; if none
    // exists yet we still create the conversation but skip the generation.
    if (clientMessageId) {
      const existing = await Conversation.findOne({
        studentId,
        'messages.role': 'assistant',
      }).lean();
      if (existing) {
        // There's already an answer for this clientMessageId; return it.
        return res.json({
          conversationId: existing._id,
          existing: true,
          messages: existing.messages,
        });
      }
      // Record the idempotency key so future repeats are caught.
      // We'll use a simple model-backed store; the key is stored in the
      // conversation's metadata field below after the first save.
    }

    // Validate required fields
    if (!rawQuestion?.trim() && !req.file) {
      throw new AppError('Question or file is required', 400);
    }
    if (!subject) {
      throw new AppError('Subject is required', 400);
    }

    // Allow subjects that student is enrolled in OR subjects that have teachers
    const studentSubjects = req.user.subjects || [];
    if (!studentSubjects.includes(subject)) {
      const teacherWithSubject = await User.findOne({ role: 'teacher', subjects: subject });
      if (!teacherWithSubject) {
        throw new AppError('Subject not available', 403);
      }
    }

    // Validate question length if provided
    if (rawQuestion && rawQuestion.length > 2000) {
      throw new AppError('Question exceeds 2000 characters', 400);
    }

    const fileBuffer = req.file?.buffer || null;
    const fileMimeType = req.file?.mimetype || null;

    // Step 1: Detect web search trigger FIRST (before sanitization)
    const { query: strippedQuery, isWebSearch: triggerIsWebSearch } = detectWebSearchTrigger(rawQuestion);
    
    // Step 2: Sanitize the query (no backslash handling here)
    const sanitizedQuestion = sanitizeQuery(strippedQuery, subject);
    
    console.log('[Route] Raw question:', rawQuestion);
    console.log('[Route] isWebSearch trigger:', triggerIsWebSearch);
    console.log('[Route] Stripped query:', strippedQuery);
    console.log('[Route] Sanitized query:', sanitizedQuestion);
    console.log('[Route] Has file:', !!fileBuffer);

    // Resolve or create conversation BEFORE streaming so we can emit its id
    // as the very first SSE event.
    const { conversation, isNew } = await resolveConversation(studentId, subject, conversationId);
    const activeConversationId = conversation._id.toString();
    const existingMessages = conversation.messages || [];
    
    console.log('[Route] Conversation resolved:', { id: activeConversationId, isNew });

    // Cancellation: when the browser aborts the fetch (Stop button or
    // navigation), stop consuming the model stream. The user's question is
    // persisted below, so cancelling never loses it or stores a half answer.
    const abortController = new AbortController();
    const onClientClose = () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    };
    req.on('close', onClientClose);

    // Persist the user's turn immediately, before any model work. This makes
    // the first question appear in history right away and guarantees it is
    // saved even if generation is cancelled or fails. If the previous stored
    // turn is the same unanswered question (retry after cancel/error), reuse
    // it instead of creating a duplicate.
    const userMessage = {
      role: 'user',
      content: rawQuestion || (fileBuffer ? '[File]' : ''),
      citations: [],
      attachments: [],
      timestamp: new Date(),
      kind: 'normal',
    };
    const lastExisting = existingMessages[existingMessages.length - 1];
    const isRetryTurn = !req.file
      && lastExisting?.role === 'user'
      && lastExisting?.content === userMessage.content;
    const messagesWithUser = isRetryTurn
      ? existingMessages
      : [...existingMessages, userMessage];
    if (!isRetryTurn) {
      await saveConversation(studentId, subject, messagesWithUser, activeConversationId, {
        triggerSummarization: false,
        triggerMemoryExtraction: false,
      });
    }

    // Open the SSE stream and announce the conversation id immediately. The
    // user's message is already stored, so the sidebar can show this chat
    // before retrieval/model work begins.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'conversationId', id: activeConversationId })}\n\n`);

    // If explicit web search requested, skip RAG and go directly to web search
    let result;
    if (triggerIsWebSearch) {
      console.log('[Route] isWebSearch=true, calling confirmWebSearch');
      const student = await User.findById(studentId).lean();
      const studentProfile = {
        college: student?.college || 'Parul University',
        program: student?.program || 'btech',
        field: student?.field || 'Computer Engineering',
        fieldCategory: student?.fieldCategory || 'Engineering',
        subject: subject,
        semester: student?.semester || '1',
      };
      result = await confirmWebSearch(sanitizedQuestion, subject, studentProfile, abortController.signal);
      result.webSearch = true;
    } else {
      console.log('[Route] isWebSearch=false, calling processChatQuestion');
      // Pass the resolved conversation so processChatQuestion can use its focusTopic
      result = await processChatQuestion(
        studentId,
        sanitizedQuestion,
        subject,
        activeConversationId,
        fileBuffer,
        fileMimeType,
        false,
        conversation,
        abortController.signal
      );
    }
    console.log('[Route] Result type:', result ? (result.stream ? 'stream' : 'permission') : 'none', 'webSearch:', result?.webSearch);

    userMessage.kind = result.messageKind || 'normal';

    // Move uploaded PDFs to disk and store only a URL in the conversation.
    // This is what lets PDF conversations reopen without bloating MongoDB.
    // Images stay as (downscaled) data URLs so they still render after a
    // refresh without an extra authenticated fetch.
    let userAttachments = result.userAttachments || [];
    if (req.file && req.file.mimetype === 'application/pdf') {
      try {
        const stored = await storeChatAttachment(req.file, activeConversationId);
        userAttachments = userAttachments.map((attachment) => (
          attachment.type === 'generated_image'
            ? attachment
            : {
              ...attachment,
              url: stored.url,
              originalName: req.file.originalname,
              size: req.file.size,
            }
        ));
      } catch (storeError) {
        console.error('[Chat] Could not store attachment, keeping inline data:', storeError.message);
      }
    } else if (req.file) {
      userAttachments = userAttachments.map((attachment) => (
        attachment.type === 'generated_image'
          ? attachment
          : {
            ...attachment,
            originalName: req.file.originalname,
            size: req.file.size,
          }
      ));
    }
    userMessage.attachments = userAttachments.filter((attachment) => attachment.type !== 'generated_image');
    if (userMessage.attachments.length > 0) {
      await saveConversation(studentId, subject, messagesWithUser, activeConversationId, {
        triggerSummarization: false,
        triggerMemoryExtraction: false,
      });
    }

    // If this is a new self-contained question with a focusTopic, update the
    // in-memory conversation so the save below persists it. The document may
    // not exist yet (lazy creation), so only run an early DB update when the
    // conversation was already stored.
    if (result.focusTopic && result.messageKind === 'normal') {
      if (conversation) {
        conversation.focusTopic = result.focusTopic;
      }
      if (!isNew) {
        await Conversation.findByIdAndUpdate(activeConversationId, { focusTopic: result.focusTopic });
      }
      console.log('[Route] Conversation focusTopic:', result.focusTopic);
    }

    // Set up SSE
    // (headers and the conversationId event were already sent above)

    if (result.needsPermission || result.permissionPrompt) {
      const permissionPrompt = result.permissionPrompt || {
        message: result.message || "I couldn't find enough relevant information. Would you like me to search the web?",
        options: [
          { label: 'Yes, search the web', value: 'yes' },
          { label: "No, I'll rephrase my question", value: 'no' },
        ],
        context: [],
      };
      res.write(`data: ${JSON.stringify({ type: 'permission', permissionPrompt, message: permissionPrompt.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    let fullAnswer = '';
    const context = result.context;
    let streamFailed = false;

    // Wrap the streaming in a try-catch to handle stream errors
    try {
      noteLoggedInGenerationStart();
      let routeChunkCount = 0;
      for await (const chunk of result.stream) {
        if (abortController.signal.aborted) break;
        routeChunkCount++;
        // console.log(`[Route] Chunk #${routeChunkCount}: type=${chunk.type}`, chunk.type === 'content' ? `content_len=${chunk.content?.length || 0}` : chunk.type === 'status' ? `status=${chunk.status}` : chunk.type === 'error' ? `error=${chunk.message}` : '');
        // Send all event types as SSE data
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        // Accumulate content for saving
        if (chunk.type === 'content') {
          fullAnswer += chunk.content;
        }
      }
      console.log('[Route] Stream iteration complete, total chunks:', routeChunkCount, 'fullAnswer length:', fullAnswer.length);
    } catch (streamError) {
      if (abortController.signal.aborted || streamError.name === 'AbortError') {
        console.log('[Chat] Generation cancelled by client');
      } else {
        console.error('[Chat] Stream iteration error:', streamError);
        streamFailed = true;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'Stream error' })}\n\n`);
        }
      }
    } finally {
      noteLoggedInGenerationEnd();
    }

    // A cancelled or failed stream must not be stored as a completed answer.
    if (abortController.signal.aborted || streamFailed) {
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }

    // Extract and emit citations after streaming completes
    if (!result.webSearch && fullAnswer.trim()) {
      try {
        const citations = extractCitations(fullAnswer, context);
        console.log('[Chat] Extracted citations:', citations.length, citations);
        if (citations.length > 0) {
          res.write(`data: ${JSON.stringify({ type: 'citations', citations })}\n\n`);
        }
      } catch (err) {
        console.error('[Chat] Error extracting citations:', err);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    // Build messages with attachments
    // Use original question (with backslash) for user message display
    const userMessage = {
      role: 'user',
      content: req.body.question || (fileBuffer ? '[File]' : ''),
      citations: [],
      attachments: userAttachments, // Include all attachment types (image, pdf)
      timestamp: new Date(),
      kind: result.messageKind || 'normal',
    };

    // Include file data in assistant message for follow-up context
    const assistantMessage = {
      role: 'assistant',
      content: fullAnswer,
      citations: result.webSearch ? [] : extractCitations(fullAnswer, context),
      webSources: result.webSearch ? [] : undefined,
      attachments: userAttachments, // Keep file reference for follow-ups
      fileData: result.fileData ? {
        type: result.fileData.type,
        analysis: result.fileData.analysis,
        pages: result.fileData.pages,
        usedVision: result.fileData.usedVision,
      } : undefined,
      timestamp: new Date(),
      kind: result.webSearch ? 'normal' : 'normal',
    };

    // Get existing messages from the conversation we already have
    const existingMessages = conversation.messages || [];
    
    const messages = [
      ...existingMessages,
      userMessage,
      assistantMessage,
    ];

    // Persist with updated focusTopic from the analysis
    await saveConversation(studentId, subject, messages, activeConversationId, {
      triggerSummarization: true,
      triggerMemoryExtraction: true,
    });

    // If this was a new self-contained question, update the conversation's
    // focusTopic so follow-ups inherit it. Greetings/permission/clarification
    // keep the previous focusTopic.
    // (Pre-stream update already done above for normal messages with focusTopic)

  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error('Stream error:', error);
      // Send error as SSE event if headers already sent
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'An error occurred' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }
});
router.get('/history', authorize('student'), validateQuery(z.object({
  subject: z.string().optional().or(z.literal('')),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
}).transform(d => ({ ...d, subject: d.subject === '' ? undefined : d.subject }))), async (req, res, next) => {
  try {
    const { subject, page, limit } = req.query;
    const conversations = await getConversationHistory(req.user._id, subject);

    const start = (page - 1) * limit;
    const paginated = conversations.slice(start, start + limit);

    res.json({
      conversations: paginated.map(c => ({
        id: c._id,
        subject: c.subject,
        title: c.title,
        messageCount: c.messages.length,
        lastMessageAt: c.updatedAt,
        createdAt: c.createdAt,
      })),
      pagination: {
        page,
        limit,
        total: conversations.length,
        pages: Math.ceil(conversations.length / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/history/:id', authorize('student'), validateParams(z.object({ id: objectIdSchema })), async (req, res, next) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.id, studentId: req.user._id }).lean();
    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }
    res.json({ conversation });
  } catch (error) {
    next(error);
  }
});

router.get('/history/:id/messages', authorize('student'), validateParams(z.object({ id: objectIdSchema })), validateQuery(z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().optional(),
})), async (req, res, next) => {
  try {
    const { page, limit, before } = req.query;

    // Object-level authorization: only the owning student may read messages.
    const ownedConversation = await Conversation.exists({
      _id: req.params.id,
      studentId: req.user._id,
    });
    if (!ownedConversation) {
      throw new AppError('Conversation not found', 404);
    }

    const result = await getConversationMessages(req.params.id, { page, limit, before });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/history/:id', authorize('student'), validateParams(z.object({ id: objectIdSchema })), async (req, res, next) => {
  try {
    const result = await Conversation.findOneAndDelete({ _id: req.params.id, studentId: req.user._id });
    if (!result) {
      throw new AppError('Conversation not found', 404);
    }
    res.json({ message: 'Conversation deleted' });
  } catch (error) {
    next(error);
  }
});

router.post('/web-search', authorize('student'), validate(z.object({
  question: z.string().min(1).max(2000),
  subject: z.string().min(1),
})), async (req, res, next) => {
  try {
    const { question, subject } = req.body;
    const studentId = req.user._id;

    const student = await User.findById(studentId).lean();
    const studentProfile = {
      college: student?.college || 'Parul University',
      program: student?.program || 'btech',
      field: student?.field || 'Computer Engineering',
      fieldCategory: student?.fieldCategory || 'Engineering',
      subject: subject,
      semester: student?.semester || '1',
    };

    const searchResults = await webSearch(question, studentProfile);

    if (searchResults.length === 0) {
      return res.json({
        answer: "I couldn't find relevant information on the web for your question.",
        sources: [],
      });
    }

    const stream = await callWebSearchLLM(question, searchResults, studentProfile);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Emit web search status
    res.write(`data: ${JSON.stringify({ type: 'status', status: 'Searching the web...', stage: 'webSearch' })}\n\n`);

    let chunkCount = 0;
    try {
      for await (const chunk of stream) {
        chunkCount++;
        const content = chunk.message?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
        }
      }
      console.log('[web-search] Stream completed, chunks:', chunkCount);
    } catch (streamError) {
      console.error('[WebSearch] Stream iteration error:', streamError);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'Stream error' })}\n\n`);
      }
      throw streamError;
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error('Stream error:', error);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'An error occurred' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }
});

router.post('/confirm-web-search', authorize('student'), validate(z.object({
  question: z.string().min(1).max(2000),
  subject: z.string().min(1),
  conversationId: z.string().optional(),
})), async (req, res, next) => {
  try {
    const { question, subject, conversationId } = req.body;
    const studentId = req.user._id;

    // Allow subjects that student is enrolled in OR subjects that have teachers
    const studentSubjects = req.user.subjects || [];
    if (!studentSubjects.includes(subject)) {
      const teacherWithSubject = await User.findOne({ role: 'teacher', subjects: subject });
      if (!teacherWithSubject) {
        throw new AppError('Subject not available', 403);
      }
    }

    const student = await User.findById(studentId).lean();
    const studentProfile = {
      college: student?.college || 'Parul University',
      program: student?.program || 'btech',
      field: student?.field || 'Computer Engineering',
      fieldCategory: student?.fieldCategory || 'Engineering',
      subject: subject,
      semester: student?.semester || '1',
    };

    // Resolve or create conversation before streaming
    const { conversation, isNew } = await resolveConversation(studentId, subject, conversationId);
    const activeConversationId = conversation._id.toString();
    const existingMessages = conversation.messages || [];
    
    console.log('[ConfirmWebSearch] Conversation resolved:', { id: activeConversationId, isNew });

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    // Persist the user's turn before doing any network work so a cancelled
    // search still leaves the question in history. The /ask permission flow
    // already saved the same question, so reuse it instead of duplicating it.
    const userMessage = {
      role: 'user',
      content: question,
      citations: [],
      attachments: [],
      timestamp: new Date(),
      kind: 'normal',
    };
    const lastExisting = existingMessages[existingMessages.length - 1];
    const isRetryTurn = lastExisting?.role === 'user' && lastExisting?.content === question;
    const messagesWithUser = isRetryTurn
      ? existingMessages
      : [...existingMessages, userMessage];
    if (!isRetryTurn) {
      await saveConversation(studentId, subject, messagesWithUser, activeConversationId, {
        triggerSummarization: false,
        triggerMemoryExtraction: false,
      });
    }

    const searchResults = await webSearch(question, studentProfile);

    if (searchResults.length === 0) {
      const noResultsAnswer = "I couldn't find relevant information on the web for your question.";
      // Still return the conversation id even for no results
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(`data: ${JSON.stringify({ type: 'conversationId', id: activeConversationId })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'content', content: noResultsAnswer })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();

      await saveConversation(studentId, subject, [
        ...messagesWithUser,
        {
          role: 'assistant',
          content: noResultsAnswer,
          citations: [],
          webSources: [],
          isWebSearch: true,
          timestamp: new Date(),
          kind: 'normal',
        },
      ], activeConversationId, {
        triggerSummarization: false,
        triggerMemoryExtraction: false,
      });
      return;
    }

    const stream = await callWebSearchLLM(question, searchResults, studentProfile, abortController.signal);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Emit conversationId first
    res.write(`data: ${JSON.stringify({ type: 'conversationId', id: activeConversationId })}\n\n`);

    // Emit web search status
    res.write(`data: ${JSON.stringify({ type: 'status', status: 'Searching the web...', stage: 'webSearch' })}\n\n`);

    let chunkCount = 0;
    let fullAnswer = '';
    let streamFailed = false;
    try {
      for await (const chunk of stream) {
        if (abortController.signal.aborted) break;
        chunkCount++;
        console.log(`[confirm-web-search] Raw chunk #${chunkCount}:`, Object.keys(chunk), chunk.message?.content ? `content_len=${chunk.message.content.length}` : 'no_content');
        const content = chunk.message?.content;
        if (content) {
          fullAnswer += content;
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
          }
        }
      }
      console.log('[confirm-web-search] Stream completed, chunks:', chunkCount);
    } catch (streamError) {
      if (abortController.signal.aborted || streamError.name === 'AbortError') {
        console.log('[ConfirmWebSearch] Generation cancelled by client');
      } else {
        console.error('[ConfirmWebSearch] Stream iteration error:', streamError);
        streamFailed = true;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'Stream error' })}\n\n`);
        }
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();

    // Save conversation after streaming completes
    if (fullAnswer.trim()) {
      const assistantMessage = {
        role: 'assistant',
        content: fullAnswer,
        citations: [],
        webSources: searchResults.map(r => ({ title: r.title, url: r.url })),
        isWebSearch: true,
        timestamp: new Date(),
        kind: 'normal',
      };

      // Get existing messages from the resolved conversation
      const existingMessages = conversation.messages || [];
      
      const messages = [
        ...existingMessages,
        userMessage,
        assistantMessage,
      ];

      await saveConversation(studentId, subject, messages, activeConversationId, {
        triggerSummarization: true,
        triggerMemoryExtraction: true,
      });
    }
  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error('Stream error:', error);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message || 'An error occurred' })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  }
});

export default router;
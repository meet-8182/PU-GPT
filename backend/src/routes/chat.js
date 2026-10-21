import { z } from 'zod';
import express from 'express';
import multer from 'multer';
import { Conversation, User } from '../models/index.js';
import { authenticate, authorize, validate, validateQuery, AppError } from '../middleware/index.js';
import { processChatQuestion, saveConversation, getConversationHistory, webSearch, confirmWebSearch, callWebSearchLLM, detectWebSearchTrigger, sanitizeQuery, expandQueryForRetrieval, extractCitations, getConversationMessages } from '../services/chat.js';
import { config } from '../config/index.js';

const router = express.Router();

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
 * POST /api/chat/ask
 * Accepts both JSON and multipart/form-data
 * multipart fields: question, subject, conversationId (optional), file (optional image/PDF)
 * Web search trigger: leading backslash in question (\ or ＼)
 */
router.post('/ask', authenticate, authorize('student'), upload.single('file'), async (req, res, next) => {
  try {
    // Handle both JSON and multipart
    const rawQuestion = req.body.question || '';
    const subject = req.body.subject;
    const conversationId = req.body.conversationId;
    const studentId = req.user._id;

    // Validate required fields
    if (!rawQuestion?.trim() && !req.file) {
      throw new AppError('Question or file is required', 400);
    }
    if (!subject) {
      throw new AppError('Subject is required', 400);
    }

    if (!req.user.subjects.includes(subject)) {
      throw new AppError('You are not enrolled in this subject', 403);
    }

    // Validate question length if provided
    if (rawQuestion && rawQuestion.length > 2000) {
      throw new AppError('Question exceeds 2000 characters', 400);
    }

    const fileBuffer = req.file?.buffer || null;
    const fileMimeType = req.file?.mimetype || null;

    // Step 1: Detect web search trigger FIRST (before sanitization)
    const { query: strippedQuery, isWebSearch } = detectWebSearchTrigger(rawQuestion);
    
    // Step 2: Sanitize the query (no backslash handling here)
    const sanitizedQuestion = sanitizeQuery(strippedQuery, subject);
    
    console.log('[Route] Raw question:', rawQuestion);
    console.log('[Route] isWebSearch:', isWebSearch);
    console.log('[Route] Stripped query:', strippedQuery);
    console.log('[Route] Sanitized query:', sanitizedQuestion);
    console.log('[Route] Has file:', !!fileBuffer);

    // If explicit web search requested, skip RAG and go directly to web search
    let result;
    if (isWebSearch) {
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
      result = await confirmWebSearch(sanitizedQuestion, subject, studentProfile);
      result.webSearch = true;
    } else {
      console.log('[Route] isWebSearch=false, calling processChatQuestion');
      // Pass isWebSearch to processChatQuestion for proper handling
      result = await processChatQuestion(studentId, sanitizedQuestion, subject, conversationId, fileBuffer, fileMimeType, isWebSearch);
    }
    console.log('[Route] Result type:', result ? (result.stream ? 'stream' : 'permission') : 'none', 'webSearch:', result?.webSearch);

    if (result.needsPermission) {
      // Send as SSE event instead of JSON response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      res.write(`data: ${JSON.stringify({ type: 'permission', permissionPrompt: result.permissionPrompt, message: result.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let fullAnswer = '';
    const context = result.context;
    const userAttachments = result.userAttachments || [];
    let conversationIdResult = conversationId;

    // Wrap the streaming in a try-catch to handle stream errors
    try {
      let routeChunkCount = 0;
      for await (const chunk of result.stream) {
        routeChunkCount++;
        console.log(`[Route] Chunk #${routeChunkCount}: type=${chunk.type}`, chunk.type === 'content' ? `content_len=${chunk.content?.length || 0}` : chunk.type === 'status' ? `status=${chunk.status}` : chunk.type === 'error' ? `error=${chunk.message}` : '');
        // Send all event types as SSE data
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

        // Accumulate content for saving
        if (chunk.type === 'content') {
          fullAnswer += chunk.content;
        }
        if (chunk.type === 'conversationId') {
          conversationIdResult = chunk.id;
        }
      }
      console.log('[Route] Stream iteration complete, total chunks:', routeChunkCount, 'fullAnswer length:', fullAnswer.length);
    } catch (streamError) {
      console.error('[Chat] Stream iteration error:', streamError);
      // Send error event if stream fails mid-way
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'Stream error' })}\n\n`);
      }
      throw streamError;
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
      timestamp: new Date()
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
      timestamp: new Date()
    };

    const messages = [
      ...(await getConversationMessages(conversationIdResult)),
      userMessage,
      assistantMessage,
    ];

    await saveConversation(studentId, subject, messages, conversationIdResult, {
      triggerSummarization: true,
      triggerMemoryExtraction: true,
    });

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
router.get('/history', authenticate, authorize('student'), validateQuery(z.object({
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

router.get('/history/:id', authenticate, authorize('student'), async (req, res, next) => {
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

router.get('/history/:id/messages', authenticate, authorize('student'), validateQuery(z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  before: z.string().optional(),
})), async (req, res, next) => {
  try {
    const { page, limit, before } = req.query;
    const result = await getConversationMessages(req.params.id, { page, limit, before });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete('/history/:id', authenticate, authorize('student'), async (req, res, next) => {
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

router.post('/web-search', authenticate, authorize('student'), validate(z.object({
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

router.post('/confirm-web-search', authenticate, authorize('student'), validate(z.object({
  question: z.string().min(1).max(2000),
  subject: z.string().min(1),
  conversationId: z.string().optional(),
})), async (req, res, next) => {
  try {
    const { question, subject, conversationId } = req.body;
    const studentId = req.user._id;

    if (!req.user.subjects.includes(subject)) {
      throw new AppError('You are not enrolled in this subject', 403);
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
    let fullAnswer = '';
    try {
      for await (const chunk of stream) {
        chunkCount++;
        console.log(`[confirm-web-search] Raw chunk #${chunkCount}:`, Object.keys(chunk), chunk.message?.content ? `content_len=${chunk.message.content.length}` : 'no_content');
        const content = chunk.message?.content;
        if (content) {
          fullAnswer += content;
          res.write(`data: ${JSON.stringify({ type: 'content', content })}\n\n`);
        }
      }
      console.log('[confirm-web-search] Stream completed, chunks:', chunkCount);
    } catch (streamError) {
      console.error('[ConfirmWebSearch] Stream iteration error:', streamError);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: streamError.message || 'Stream error' })}\n\n`);
      }
      throw streamError;
    }

    res.write('data: [DONE]\n\n');
    res.end();

    // Save conversation after streaming completes
    if (fullAnswer.trim()) {
      const userMessage = {
        role: 'user',
        content: question,
        citations: [],
        attachments: [],
        timestamp: new Date(),
      };

      const assistantMessage = {
        role: 'assistant',
        content: fullAnswer,
        citations: [],
        webSources: searchResults.map(r => ({ title: r.title, url: r.url })),
        timestamp: new Date(),
      };

      const messages = [
        ...(await getConversationMessages(conversationId)),
        userMessage,
        assistantMessage,
      ];

      await saveConversation(studentId, subject, messages, conversationId, {
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
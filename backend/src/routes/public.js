import express from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { GuestFeedback } from '../models/index.js';
import { processGuestQuestion, getGuestInfoStatus } from '../services/guestChat.js';
import {
  checkGuestRateLimit,
  acquireGuestSlot,
  releaseGuestSlot,
  clientIp,
  verifyCaptcha,
  normalizeGuestHistory,
} from '../services/guestLimits.js';

const router = express.Router();

const MAX_BODY_BYTES = 16 * 1024;

const askSchema = z.object({
  message: z.string().trim().min(1).max(config.guestMaxMessageChars),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(1000),
  })).max(config.guestMaxHistoryTurns * 2).optional().default([]),
});

const feedbackSchema = z.object({
  vote: z.enum(['up', 'down']),
});

function guestDisabled(res) {
  return res.status(404).json({ error: 'Guest mode is disabled', code: 'GUEST_DISABLED' });
}

function rejectIfOversized(req, res) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: 'Request body is too large', code: 'BODY_TOO_LARGE' });
    return true;
  }
  try {
    if (Buffer.byteLength(JSON.stringify(req.body || {})) > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Request body is too large', code: 'BODY_TOO_LARGE' });
      return true;
    }
  } catch {
    res.status(400).json({ error: 'Malformed request body', code: 'INVALID_INPUT' });
    return true;
  }
  return false;
}

function startSse(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function writeEvent(res, event) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

// GET /api/public/info-status
router.get('/info-status', async (req, res, next) => {
  if (!config.guestModeEnabled) return guestDisabled(res);
  try {
    const status = await getGuestInfoStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// POST /api/public/ask - SSE, no auth, stores nothing
router.post('/ask', async (req, res, next) => {
  if (!config.guestModeEnabled) return guestDisabled(res);
  if (rejectIfOversized(req, res)) return;

  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: `Message must be between 1 and ${config.guestMaxMessageChars} characters, and history is limited to ${config.guestMaxHistoryTurns} turns.`,
      code: 'INVALID_INPUT',
    });
  }

  if (!(await verifyCaptcha(req))) {
    return res.status(400).json({
      error: 'Please complete the verification challenge and try again.',
      code: 'CAPTCHA_REQUIRED',
    });
  }

  const ip = clientIp(req);
  const limit = checkGuestRateLimit(ip);
  if (!limit.allowed) {
    res.set('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: limit.reason === 'daily'
        ? 'You have reached today\'s guest question limit. Please log in for more help.'
        : 'You are asking questions too quickly. Please wait a moment and try again.',
      code: 'GUEST_RATE_LIMITED',
      retryAfter: limit.retryAfter,
    });
  }

  if (!acquireGuestSlot()) {
    res.set('Retry-After', '60');
    return res.status(503).json({
      error: 'The assistant is busy. Please try again in a minute.',
      code: 'GUEST_BUSY',
    });
  }

  try {
    const history = normalizeGuestHistory(parsed.data.history);
    const result = await processGuestQuestion({ message: parsed.data.message, history });

    startSse(res);
    writeEvent(res, { type: 'status', status: 'Checking approved university information...', stage: 'retrieval' });

    try {
      for await (const event of result.stream) {
        writeEvent(res, event);
      }
    } catch (streamError) {
      // Log details server-side; the visitor only sees a friendly message.
      console.error('[Guest] Stream failed:', streamError.message);
      writeEvent(res, {
        type: 'error',
        message: 'Something went wrong while answering. Please try again.',
      });
    }

    writeEvent(res, { type: 'done' });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      next(error);
    } else {
      console.error('[Guest] Unexpected stream error:', error.message);
      writeEvent(res, {
        type: 'error',
        message: 'Something went wrong while answering. Please try again.',
      });
      if (!res.writableEnded) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }
  } finally {
    releaseGuestSlot();
  }
});

// POST /api/public/feedback - anonymous aggregate thumbs up/down per day
router.post('/feedback', async (req, res, next) => {
  if (!config.guestModeEnabled) return guestDisabled(res);
  if (rejectIfOversized(req, res)) return;

  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid feedback', code: 'INVALID_INPUT' });
  }

  const limit = checkGuestRateLimit(clientIp(req));
  if (!limit.allowed) {
    res.set('Retry-After', String(limit.retryAfter));
    return res.status(429).json({
      error: 'Too many feedback submissions. Please try again later.',
      code: 'GUEST_RATE_LIMITED',
      retryAfter: limit.retryAfter,
    });
  }

  try {
    const date = new Date().toISOString().slice(0, 10);
    const field = parsed.data.vote === 'up' ? 'up' : 'down';
    await GuestFeedback.findOneAndUpdate(
      { date },
      { $inc: { [field]: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;

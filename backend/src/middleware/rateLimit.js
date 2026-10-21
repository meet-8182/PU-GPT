import { config } from '../config/index.js';
import { AppError } from './errorHandler.js';

/**
 * In-memory rate limiter (per user per endpoint type)
 * For production with multiple instances, use Redis-based rate limiting
 */
const rateLimitStore = new Map();

/**
 * Cleanup old entries periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now - data.resetTime > 60000) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

/**
 * Creates a rate limiter middleware
 * @param {string} type - 'ocr' | 'generate' | 'history'
 * @returns Express middleware
 */
export function createRateLimiter(type) {
  const limits = {
    ocr: config.rateLimitOcrPerMin,
    generate: config.rateLimitImageGenPerMin,
    history: config.rateLimitImageHistoryPerMin,
  };

  const maxRequests = limits[type] || 60;

  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const userId = req.user._id.toString();
    const key = `ratelimit:${type}:${userId}`;
    const now = Date.now();

    let data = rateLimitStore.get(key);

    if (!data || now - data.resetTime >= 60000) {
      // New window
      data = {
        count: 0,
        resetTime: now,
      };
      rateLimitStore.set(key, data);
    }

    data.count++;

    const remaining = Math.max(0, maxRequests - data.count);
    const resetIn = Math.ceil((60000 - (now - data.resetTime)) / 1000);

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': remaining,
      'X-RateLimit-Reset': resetIn,
    });

    if (data.count > maxRequests) {
      return res.status(429).json({
        error: `Rate limit exceeded. Maximum ${maxRequests} requests per minute for ${type}.`,
        retryAfter: resetIn,
      });
    }

    next();
  };
}

/**
 * Pre-configured rate limiters
 */
export const ocrRateLimit = createRateLimiter('ocr');
export const generateRateLimit = createRateLimiter('generate');
export const historyRateLimit = createRateLimiter('history');
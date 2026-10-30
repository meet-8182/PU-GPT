import { config } from '../config/index.js';

/**
 * In-memory rate limiting / lockout helpers.
 *
 * For production with multiple instances, back this with Redis so limits are
 * shared between processes.
 */
const rateLimitStore = new Map();
const loginFailures = new Map();

const clientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now >= data.expiresAt) rateLimitStore.delete(key);
  }
  for (const [key, data] of loginFailures.entries()) {
    if (now >= data.expiresAt) loginFailures.delete(key);
  }
}, 60000);

// Do not keep the process alive just for cleanup (useful for tests/scripts).
cleanupTimer.unref?.();

/**
 * Sliding-window limiter factory.
 */
export function createWindowLimiter({ name, windowMs, max, keyGenerator }) {
  return (req, res, next) => {
    const key = `ratelimit:${name}:${keyGenerator(req)}`;
    const now = Date.now();

    let data = rateLimitStore.get(key);
    if (!data || now >= data.expiresAt) {
      data = { count: 0, expiresAt: now + windowMs };
      rateLimitStore.set(key, data);
    }

    data.count++;

    const remaining = Math.max(0, max - data.count);
    const resetIn = Math.max(0, Math.ceil((data.expiresAt - now) / 1000));

    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetIn),
    });

    if (data.count > max) {
      res.set('Retry-After', String(resetIn));
      return res.status(429).json({
        error: `Too many requests. Try again in ${resetIn} seconds.`,
        retryAfter: resetIn,
      });
    }

    next();
  };
}

/**
 * Creates a per-user rate limiter middleware.
 * @param {string} type - 'ocr' | 'generate' | 'history'
 */
export function createRateLimiter(type) {
  const limits = {
    ocr: config.rateLimitOcrPerMin,
    generate: config.rateLimitImageGenPerMin,
    history: config.rateLimitImageHistoryPerMin,
  };

  return createWindowLimiter({
    name: type,
    windowMs: 60000,
    max: limits[type] || 60,
    keyGenerator: (req) => (req.user ? req.user._id.toString() : clientIp(req)),
  });
}

// Per-IP limits on credential endpoints (brute force / credential stuffing).
export const loginRateLimit = createWindowLimiter({
  name: 'auth:login',
  windowMs: config.rateLimitLoginWindowMs,
  max: config.rateLimitLoginPerWindow,
  keyGenerator: clientIp,
});

export const registerRateLimit = createWindowLimiter({
  name: 'auth:register',
  windowMs: config.rateLimitRegisterWindowMs,
  max: config.rateLimitRegisterPerWindow,
  keyGenerator: clientIp,
});

/**
 * Per-account lockout after repeated failed logins.
 */
const failureKey = (email) => `login:${String(email || '').trim().toLowerCase()}`;

export function getLoginLockout(email) {
  const key = failureKey(email);
  const data = loginFailures.get(key);
  if (!data) return { locked: false, retryAfter: 0 };

  const now = Date.now();
  if (data.lockedUntil && now < data.lockedUntil) {
    return { locked: true, retryAfter: Math.ceil((data.lockedUntil - now) / 1000) };
  }

  if (now >= data.expiresAt) loginFailures.delete(key);
  return { locked: false, retryAfter: 0 };
}

export function recordLoginFailure(email) {
  const key = failureKey(email);
  const now = Date.now();
  const current = loginFailures.get(key);

  const data = current && now < current.expiresAt
    ? current
    : { count: 0, lockedUntil: 0, expiresAt: now + config.loginLockoutMs };

  data.count++;
  if (data.count >= config.loginLockoutThreshold) {
    data.lockedUntil = now + config.loginLockoutMs;
    data.expiresAt = data.lockedUntil;
  }

  loginFailures.set(key, data);
  return { locked: data.count >= config.loginLockoutThreshold };
}

export function clearLoginFailures(email) {
  loginFailures.delete(failureKey(email));
}

/**
 * Pre-configured rate limiters
 */
export const ocrRateLimit = createRateLimiter('ocr');
export const generateRateLimit = createRateLimiter('generate');
export const historyRateLimit = createRateLimiter('history');

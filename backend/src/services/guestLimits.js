import { config } from '../config/index.js';

/**
 * Guest-mode abuse and load protection.
 *
 * Counters are kept in process memory only. They are never written to MongoDB
 * and IP addresses are never persisted. For multi-instance deployments this
 * module is the single place to swap in Redis counters.
 */
const minuteCounters = new Map(); // key -> { count, expiresAt }
const dailyCounters = new Map(); // key -> { count, day }

let activeGuestGenerations = 0;
let activeLoggedInGenerations = 0;

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, data] of minuteCounters.entries()) {
    if (now >= data.expiresAt) minuteCounters.delete(key);
  }
  const today = utcDay();
  for (const [key, data] of dailyCounters.entries()) {
    if (data.day !== today) dailyCounters.delete(key);
  }
}, 60000);
cleanupTimer.unref?.();

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Sliding-window per-IP limit (minute) plus a daily cap.
 */
export function checkGuestRateLimit(ip, {
  now = Date.now(),
  minuteLimit = config.guestRateLimitPerMin,
  dailyLimit = config.guestDailyLimit,
} = {}) {
  const minuteKey = `${ip}:minute`;
  const minute = minuteCounters.get(minuteKey);

  if (!minute || now >= minute.expiresAt) {
    minuteCounters.set(minuteKey, { count: 1, expiresAt: now + 60000 });
  } else {
    minute.count += 1;
    if (minute.count > minuteLimit) {
      return {
        allowed: false,
        reason: 'minute',
        retryAfter: Math.max(1, Math.ceil((minute.expiresAt - now) / 1000)),
      };
    }
  }

  const day = utcDay(now);
  const dailyKey = `${ip}:daily`;
  const daily = dailyCounters.get(dailyKey);
  if (!daily || daily.day !== day) {
    dailyCounters.set(dailyKey, { count: 1, day });
  } else {
    daily.count += 1;
    if (daily.count > dailyLimit) {
      return { allowed: false, reason: 'daily', retryAfter: 3600 };
    }
  }

  return { allowed: true, reason: null, retryAfter: 0 };
}

/**
 * Concurrency guard. Logged-in users are served first: when logged-in work is
 * active, at most one guest generation may run at a time.
 */
export function acquireGuestSlot() {
  if (activeGuestGenerations >= config.guestMaxConcurrent) return false;
  if (activeLoggedInGenerations > 0 && activeGuestGenerations >= 1) return false;
  activeGuestGenerations += 1;
  return true;
}

export function releaseGuestSlot() {
  if (activeGuestGenerations > 0) activeGuestGenerations -= 1;
}

export function noteLoggedInGenerationStart() {
  activeLoggedInGenerations += 1;
}

export function noteLoggedInGenerationEnd() {
  if (activeLoggedInGenerations > 0) activeLoggedInGenerations -= 1;
}

export function getGuestLoad() {
  return {
    activeGuestGenerations,
    activeLoggedInGenerations,
    maxConcurrent: config.guestMaxConcurrent,
  };
}

/**
 * Optional CAPTCHA hook. Disabled unless CAPTCHA_PROVIDER is set. When a
 * provider is configured, verification must be implemented here before guest
 * mode is exposed; until then requests fail closed.
 */
export async function verifyCaptcha() {
  if (!config.captchaProvider) return true;
  console.warn(
    '[Guest] CAPTCHA_PROVIDER is set but no verification implementation is installed; rejecting guest request.'
  );
  return false;
}

/**
 * Remove emails, phone numbers and long digit strings before an unanswered
 * guest question is optionally logged.
 */
export function sanitizeUnansweredQuestion(question) {
  return String(question || '')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email removed]')
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, '[number removed]')
    .replace(/\b\d{6,}\b/g, '[number removed]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Keep only the last N user/assistant turns and cap each message length.
 */
export function normalizeGuestHistory(history, maxTurns = config.guestMaxHistoryTurns) {
  if (!Array.isArray(history)) return [];
  const maxMessages = Math.max(0, maxTurns) * 2;
  return history
    .filter((item) => item
      && (item.role === 'user' || item.role === 'assistant')
      && typeof item.content === 'string'
      && item.content.trim())
    .slice(-maxMessages)
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, 1000),
    }));
}

// Test-only helpers.
export function __resetGuestLimits() {
  minuteCounters.clear();
  dailyCounters.clear();
  activeGuestGenerations = 0;
  activeLoggedInGenerations = 0;
}

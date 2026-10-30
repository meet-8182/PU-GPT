import dotenv from 'dotenv';
dotenv.config();

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseList = (value, fallback = []) => {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const nodeEnv = process.env.NODE_ENV || 'development';

export const config = {
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: parseInt(process.env.PORT) || 3001,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  chromaUrl: process.env.CHROMA_URL,
  ollamaHost: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB

  // Reverse proxy (needed for correct client IPs in rate limiting when behind nginx/etc.)
  trustProxy: process.env.TRUST_PROXY || false,

  // CORS allowlist. Comma-separated list of exact origins, never a wildcard.
  corsOrigins: parseList(process.env.FRONTEND_URL, ['http://localhost:5173']),

  // MongoDB TLS. Only enabled explicitly; invalid certificates/hostnames are never allowed.
  mongoTls: parseBool(process.env.MONGO_TLS, false),
  mongoTlsCAFile: process.env.MONGO_TLS_CA_FILE,
  mongoTlsCertKeyFile: process.env.MONGO_TLS_CERT_KEY_FILE,

  // Debug/diagnostic routes are opt-in and disabled in production by default.
  enableDebugRoutes: parseBool(process.env.ENABLE_DEBUG_ROUTES, nodeEnv !== 'production'),

  // OCR
  ocrModel: process.env.OCR_MODEL || 'glm-ocr',
  ocrTimeoutMs: parseInt(process.env.OCR_TIMEOUT_MS) || 120000,
  maxImageUploadSize: parseInt(process.env.MAX_IMAGE_UPLOAD_SIZE) || 10485760,

  // Vision Model (for image/PDF analysis)
  visionModel: process.env.VISION_MODEL || 'llava-llama3:8b',
  visionMaxImageSize: parseInt(process.env.VISION_MAX_IMAGE_SIZE) || 2097152, // 2MB for vision model
  visionTimeoutMs: parseInt(process.env.VISION_TIMEOUT_MS) || 180000,

  // Chat/Streaming timeouts
  chatTimeoutMs: parseInt(process.env.CHAT_TIMEOUT_MS) || 180000, // 3 minutes for chat streaming
  webSearchTimeoutMs: parseInt(process.env.WEB_SEARCH_TIMEOUT_MS) || 60000, // 1 minute for web search LLM

  // Image Generation
  imageGenModel: process.env.IMAGE_GEN_MODEL || 'x/z-image-turbo',
  imageGenTimeoutMs: parseInt(process.env.IMAGE_GEN_TIMEOUT_MS) || 180000,
  imageGenConcurrency: parseInt(process.env.IMAGE_GEN_CONCURRENCY) || 1,
  imageGenDefaultWidth: parseInt(process.env.DEFAULT_IMAGE_WIDTH) || 768,
  imageGenDefaultHeight: parseInt(process.env.DEFAULT_IMAGE_HEIGHT) || 768,
  maxImageGenWidth: parseInt(process.env.MAX_IMAGE_GEN_WIDTH) || 1024,
  maxImageGenHeight: parseInt(process.env.MAX_IMAGE_GEN_HEIGHT) || 1024,

  // ComfyUI Settings
  comfyuiBaseUrl: process.env.COMFYUI_BASE_URL || 'http://127.0.0.1:8188',
  comfyuiTimeoutMs: parseInt(process.env.COMFYUI_TIMEOUT_MS) || 300000, // 5 min for generation
  comfyuiWorkflowPath: process.env.COMFYUI_WORKFLOW_PATH || './comfyui-workflows/z-image-turbo.json',

  // Rate limits (per authenticated user)
  rateLimitOcrPerMin: parseInt(process.env.RATE_LIMIT_OCR_PER_MIN) || 30,
  rateLimitImageGenPerMin: parseInt(process.env.RATE_LIMIT_IMAGE_GEN_PER_MIN) || 10,
  rateLimitImageHistoryPerMin: parseInt(process.env.RATE_LIMIT_IMAGE_HISTORY_PER_MIN) || 60,

  // Authentication rate limits / lockout
  rateLimitLoginPerWindow: parseInt(process.env.RATE_LIMIT_LOGIN_PER_WINDOW) || 20,
  rateLimitLoginWindowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS) || 15 * 60 * 1000,
  rateLimitRegisterPerWindow: parseInt(process.env.RATE_LIMIT_REGISTER_PER_WINDOW) || 10,
  rateLimitRegisterWindowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW_MS) || 60 * 60 * 1000,
  loginLockoutThreshold: parseInt(process.env.LOGIN_LOCKOUT_THRESHOLD) || 5,
  loginLockoutMs: parseInt(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000,

  // Alias for images route
  defaultImageWidth: parseInt(process.env.DEFAULT_IMAGE_WIDTH) || 768,
  defaultImageHeight: parseInt(process.env.DEFAULT_IMAGE_HEIGHT) || 768,
};

const WEAK_SECRET_PATTERN = /(your[-_]?super[-_]?secret|change[-_]?in[-_]?production|changeme|secret123|password)/i;

/**
 * Fails fast on insecure/missing configuration instead of silently running with
 * an undefined JWT secret or unscoped database connection.
 */
export function validateConfig() {
  const errors = [];

  if (!config.mongoUri) {
    errors.push('MONGO_URI is required');
  }

  if (!config.jwtSecret) {
    errors.push('JWT_SECRET is required (generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))")');
  } else if (config.jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters long');
  } else if (WEAK_SECRET_PATTERN.test(config.jwtSecret)) {
    errors.push('JWT_SECRET is a known placeholder/weak value; generate a unique random secret');
  }

  if (config.jwtSecret && config.jwtSecret.length < 64 && config.isProduction) {
    errors.push('JWT_SECRET must be at least 64 characters in production');
  }

  if (config.corsOrigins.includes('*')) {
    errors.push('FRONTEND_URL must contain explicit origins, not "*"');
  }

  if (config.isProduction && config.enableDebugRoutes) {
    console.warn('[config] WARNING: ENABLE_DEBUG_ROUTES is enabled in production');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join('\n- ')}`);
  }
}

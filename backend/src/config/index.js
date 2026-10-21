import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT) || 3001,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  chromaUrl: process.env.CHROMA_URL,
  ollamaHost: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  uploadDir: process.env.UPLOAD_DIR,
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760, // 10MB

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

  // Rate limits
  rateLimitOcrPerMin: parseInt(process.env.RATE_LIMIT_OCR_PER_MIN) || 30,
  rateLimitImageGenPerMin: parseInt(process.env.RATE_LIMIT_IMAGE_GEN_PER_MIN) || 10,
  rateLimitImageHistoryPerMin: parseInt(process.env.RATE_LIMIT_IMAGE_HISTORY_PER_MIN) || 60,

  // Alias for images route
  defaultImageWidth: parseInt(process.env.DEFAULT_IMAGE_WIDTH) || 768,
  defaultImageHeight: parseInt(process.env.DEFAULT_IMAGE_HEIGHT) || 768,
};
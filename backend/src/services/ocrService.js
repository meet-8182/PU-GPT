import { Ollama } from 'ollama';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import fs from 'fs/promises';

const ollama = new Ollama({ host: config.ollamaHost });

const OCR_TIMEOUT_MS = config.ocrTimeoutMs || 120000;

/**
 * Wrapper to add timeout to Ollama generate requests
 * @param {Object} params - Parameters for ollama.generate()
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>} - Ollama generate response
 */
async function ollamaGenerateWithTimeout(params, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[OCR] Request timeout after ${timeoutMs}ms, aborting...`);
    controller.abort();
  }, timeoutMs);

  try {
    console.log(`[OCR] Starting generate request (model: ${params.model}, timeout: ${timeoutMs}ms)`);
    const startTime = Date.now();
    
    const response = await ollama.generate({
      ...params,
      signal: controller.signal,
    });
    
    console.log(`[OCR] Request completed in ${Date.now() - startTime}ms`);
    return response;
  } catch (error) {
    if (error.name === 'AbortError' || error.message?.includes('abort')) {
      throw new Error(`OCR request timed out after ${timeoutMs}ms`);
    }
    console.error('[OCR] Request error:', error.message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Extract text from image using glm-ocr via Ollama
 * Supports: png, jpg, jpeg, webp (via buffer or file path)
 * @param {Buffer|string} input - Image file buffer or file path
 * @param {string} [mimeType] - MIME type (required if input is buffer)
 * @returns {Promise<{text: string, durationMs: number}>}
 */
export async function extractText(input, mimeType) {
  const startTime = Date.now();

  let base64;
  let detectedMimeType = mimeType;

  if (typeof input === 'string') {
    // Input is file path
    const buffer = await fs.readFile(input);
    base64 = buffer.toString('base64');
    // Detect mime type from extension if not provided
    if (!detectedMimeType) {
      const ext = input.split('.').pop()?.toLowerCase();
      const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
      detectedMimeType = mimeMap[ext] || 'image/png';
    }
  } else {
    // Input is buffer
    if (!mimeType) {
      throw new AppError('MIME type required when providing buffer', 400);
    }
    base64 = input.toString('base64');
    detectedMimeType = mimeType;
  }

  try {
    const response = await ollamaGenerateWithTimeout({
      model: config.ocrModel,
      prompt: 'Extract all text from this image. Return only the extracted text, no additional commentary.',
      images: [base64],
      options: {
        temperature: 0,
        num_predict: 2048,
        num_ctx: 4096,
      },
      stream: false,
    }, OCR_TIMEOUT_MS);

    const text = response.response?.trim() || '';
    const durationMs = Date.now() - startTime;

    if (!text) {
      throw new AppError('No text could be extracted from the image', 422);
    }

    return { text, durationMs };
  } catch (err) {
    if (err instanceof AppError) throw err;

    // Check if model is not available
    if (err.message?.includes('model') && err.message?.includes('not found')) {
      throw new AppError(`OCR model "${config.ocrModel}" is not available. Please pull it with: ollama pull ${config.ocrModel}`, 503);
    }

    console.error('OCR error:', err);
    throw new AppError('OCR processing failed. Please try again.', 500);
  }
}

/**
 * Check if OCR model is available
 */
export async function checkOcrHealth() {
  try {
    const response = await ollama.list();
    const models = response.models || [];
    const available = models.some(m => m.name?.includes(config.ocrModel.replace(':', '-')) || m.name?.includes(config.ocrModel));
    return {
      model: config.ocrModel,
      available,
      status: available ? 'healthy' : 'unavailable'
    };
  } catch (err) {
    console.error('OCR health check failed:', err);
    return {
      model: config.ocrModel,
      available: false,
      status: 'error',
      error: err.message
    };
  }
}
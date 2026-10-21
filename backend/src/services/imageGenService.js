import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import fs from 'fs/promises';
import { generateImage as comfyGenerateImage, checkComfyUIHealth } from './comfyuiService.js';
import { generateImage as ollamaGenerateImage, checkImageGenHealth as checkOllamaHealth, deleteGeneratedImage } from './imageGenService.ollama.js';

/**
 * Generate image using ComfyUI (primary) with Ollama fallback
 * Returns buffer directly (no file saving - handled by caller)
 * @param {string} prompt - Image generation prompt
 * @param {Object} options - { width, height, seed? }
 * @returns {Promise<{buffer: Buffer, mimeType: string, width: number, height: number}>}
 */
export async function generateImage(prompt, { width, height, seed } = {}) {
  const w = width || config.imageGenDefaultWidth;
  const h = height || config.imageGenDefaultHeight;

  // Try ComfyUI first if configured
  if (config.comfyuiBaseUrl) {
    try {
      console.log('[ImageGen] Attempting ComfyUI generation...');
      const result = await comfyGenerateImage(prompt, { width: w, height: h, seed });
      console.log('[ImageGen] ComfyUI generation successful');
      return result;
    } catch (err) {
      console.warn('[ImageGen] ComfyUI failed, falling back to Ollama:', err.message);
      // Fall through to Ollama
    }
  }

  // Fallback to Ollama (x/z-image-turbo)
  try {
    console.log('[ImageGen] Using Ollama fallback...');
    return await ollamaGenerateImage(prompt, { width: w, height: h, seed });
  } catch (err) {
    console.error('[ImageGen] Both ComfyUI and Ollama failed:', err.message);
    throw err;
  }
}

/**
 * Check if image generation is available (ComfyUI or Ollama)
 */
export async function checkImageGenHealth() {
  const results = {};

  // Check ComfyUI
  if (config.comfyuiBaseUrl) {
    try {
      const health = await checkComfyUIHealth();
      results.comfyui = health;
    } catch (err) {
      results.comfyui = { status: 'error', error: err.message };
    }
  }

  // Check Ollama
  try {
    const health = await checkOllamaHealth();
    results.ollama = health;
  } catch (err) {
    results.ollama = { status: 'error', error: err.message };
  }

  // Determine overall status
  const comfyuiHealthy = results.comfyui?.status === 'healthy';
  const ollamaHealthy = results.ollama?.available === true;

  return {
    comfyui: results.comfyui,
    ollama: results.ollama,
    overall: comfyuiHealthy || ollamaHealthy ? 'healthy' : 'unavailable',
    primary: comfyuiHealthy ? 'comfyui' : (ollamaHealthy ? 'ollama' : 'none'),
  };
}

export { deleteGeneratedImage };
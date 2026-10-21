import { Ollama } from 'ollama';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import fs from 'fs/promises';

const ollama = new Ollama({ host: config.ollamaHost });

/**
 * Delete generated image file from disk
 * @param {string} filePath - Path to the image file
 */
export async function deleteGeneratedImage(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    // Ignore if file doesn't exist
    if (err.code !== 'ENOENT') {
      console.error('Failed to delete image file:', err);
    }
  }
}

/**
 * Generate image using x/z-image-turbo via Ollama
 * Returns buffer directly (no file saving - handled by caller)
 * @param {string} prompt - Image generation prompt
 * @param {Object} options - { width, height, seed? }
 * @returns {Promise<{buffer: Buffer, mimeType: string, width: number, height: number}>}
 */
export async function generateImage(prompt, { width, height, seed } = {}) {
  const w = width || config.imageGenDefaultWidth;
  const h = height || config.imageGenDefaultHeight;

  // Build the prompt for x/z-image-turbo
  // This model expects specific format
  const fullPrompt = `${prompt} --width ${w} --height ${h}${seed ? ` --seed ${seed}` : ''}`;

  try {
    const response = await ollama.generate({
      model: config.imageGenModel,
      prompt: fullPrompt,
      options: {
        temperature: 0.7,
        num_predict: 4096,
        num_ctx: 4096,
      },
      stream: false,
    });

    // Defensive parsing: x/z-image-turbo returns base64 in response.response
    // or sometimes in response.images[0]
    let base64 = null;

    if (response.response) {
      // Try to extract base64 from response text
      const match = response.response.match(/([A-Za-z0-9+/=]{100,})/);
      if (match) {
        base64 = match[1];
      }
    }

    if (response.images && response.images.length > 0) {
      base64 = response.images[0];
    }

    if (!base64) {
      console.error('Unexpected Ollama response:', JSON.stringify(response, null, 2).slice(0, 2000));
      throw new AppError('Image generation returned no image data', 500);
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(base64, 'base64');
    const mimeType = 'image/png'; // x/z-image-turbo outputs PNG

    return { buffer, mimeType, width: w, height: h };
  } catch (err) {
    if (err instanceof AppError) throw err;

    // Check if model is not available
    if (err.message?.includes('model') && err.message?.includes('not found')) {
      throw new AppError(`Image generation model "${config.imageGenModel}" is not available. This model may not be supported on your platform.`, 503);
    }

    console.error('Image generation error:', err);
    throw new AppError('Image generation failed. Please try again.', 500);
  }
}

/**
 * Check if image generation model is available
 */
export async function checkImageGenHealth() {
  try {
    const response = await ollama.list();
    const models = response.models || [];
    const available = models.some(m =>
      m.name?.includes(config.imageGenModel.replace('/', '-')) ||
      m.name?.includes(config.imageGenModel.replace(':', '-'))
    );
    return {
      model: config.imageGenModel,
      available,
      status: available ? 'healthy' : 'unavailable',
      note: available ? null : 'Model may not be supported on this platform (Windows known issue)'
    };
  } catch (err) {
    console.error('Image gen health check failed:', err);
    return {
      model: config.imageGenModel,
      available: false,
      status: 'error',
      error: err.message
    };
  }
}
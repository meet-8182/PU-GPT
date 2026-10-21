import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

const COMFYUI_API = `${config.comfyuiBaseUrl}/api`;

/**
 * ComfyUI Service for Z-Image Turbo integration
 * Handles prompt submission, job tracking, and output retrieval via ComfyUI REST API
 */

/**
 * Submit a prompt/workflow to ComfyUI
 * @param {Object} workflow - The workflow JSON object
 * @param {string} clientId - Unique client ID for tracking
 * @returns {Promise<{promptId: string}>}
 */
export async function submitPrompt(workflow, clientId = 'pu-gpt') {
  const response = await fetch(`${COMFYUI_API}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: workflow,
      client_id: clientId,
    }),
    signal: AbortSignal.timeout(config.comfyuiTimeoutMs || 300000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new AppError(`ComfyUI prompt submission failed: ${errorText}`, 500);
  }

  const data = await response.json();
  return { promptId: data.prompt_id };
}

/**
 * Get the history/output for a prompt ID
 * @param {string} promptId - The prompt ID returned from submitPrompt
 * @returns {Promise<Object>} - History data with outputs
 */
export async function getPromptHistory(promptId) {
  const response = await fetch(`${COMFYUI_API}/history/${promptId}`, {
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new AppError(`Failed to get prompt history: ${response.statusText}`, 500);
  }

  return response.json();
}

/**
 * Get queue status
 * @returns {Promise<Object>} - Queue info
 */
export async function getQueueStatus() {
  const response = await fetch(`${COMFYUI_API}/queue`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new AppError(`Failed to get queue status: ${response.statusText}`, 500);
  }

  return response.json();
}

/**
 * Get system stats (VRAM, etc.)
 * @returns {Promise<Object>} - System stats
 */
export async function getSystemStats() {
  const response = await fetch(`${config.comfyuiBaseUrl}/system_stats`, {
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new AppError(`Failed to get system stats: ${response.statusText}`, 500);
  }

  return response.json();
}

/**
 * Check if ComfyUI is healthy and reachable
 * @returns {Promise<Object>} - Health status
 */
export async function checkComfyUIHealth() {
  try {
    const stats = await getSystemStats();
    return {
      status: 'healthy',
      device: stats.device || 'unknown',
      vramFree: stats.vram_free || 0,
      vramTotal: stats.vram_total || 0,
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      error: err.message,
    };
  }
}

/**
 * Load workflow from file
 * @param {string} workflowPath - Path to workflow JSON
 * @returns {Promise<Object>} - Parsed workflow
 */
export async function loadWorkflow(workflowPath = config.comfyuiWorkflowPath) {
  const fullPath = path.isAbsolute(workflowPath)
    ? workflowPath
    : path.resolve(process.cwd(), workflowPath);

  const content = await fs.readFile(fullPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Inject prompt and parameters into workflow
 * @param {Object} workflow - Base workflow
 * @param {string} prompt - User prompt
 * @param {Object} options - { width, height, seed, steps, cfg }
 * @returns {Object} - Modified workflow
 */
export function injectWorkflowParams(workflow, prompt, options = {}) {
  const {
    width = config.imageGenDefaultWidth,
    height = config.imageGenDefaultHeight,
    seed = Math.floor(Math.random() * 2**32),
    steps = 4, // Turbo models use few steps
    cfg = 1,   // Turbo models use cfg=1
  } = options;

  // Deep clone to avoid mutating original
  const modified = JSON.parse(JSON.stringify(workflow));

  // Find and update nodes by class type
  for (const [nodeId, node] of Object.entries(modified)) {
    // Update KSampler
    if (node.class_type === 'KSampler') {
      node.inputs.seed = seed;
      node.inputs.steps = steps;
      node.inputs.cfg = cfg;
    }
    // Update EmptyLatentImage for dimensions
    if (node.class_type === 'EmptyLatentImage') {
      node.inputs.width = width;
      node.inputs.height = height;
    }
    // Update positive prompt
    if (node.class_type === 'CLIPTextEncode' && node._meta?.title?.includes('Positive')) {
      node.inputs.text = prompt;
    }
    // Update negative prompt (optional - keep default)
    if (node.class_type === 'CLIPTextEncode' && node._meta?.title?.includes('Negative')) {
      // Keep default negative prompt
    }
  }

  return modified;
}

/**
 * Wait for prompt completion and get output images
 * @param {string} promptId - Prompt ID from submitPrompt
 * @param {number} maxWaitMs - Maximum wait time
 * @param {number} pollIntervalMs - Poll interval
 * @returns {Promise<Array<{filename: string, subfolder: string, type: string}>>}
 */
export async function waitForCompletion(promptId, maxWaitMs = config.comfyuiTimeoutMs || 300000, pollIntervalMs = 2000) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const history = await getPromptHistory(promptId);

    if (history[promptId] && history[promptId].outputs) {
      const outputs = history[promptId].outputs;
      const images = [];

      // Collect all SaveImage outputs
      for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
        if (nodeOutput.images && nodeOutput.images.length > 0) {
          for (const img of nodeOutput.images) {
            images.push({
              filename: img.filename,
              subfolder: img.subfolder || '',
              type: img.type || 'output',
              nodeId,
            });
          }
        }
      }

      if (images.length > 0) {
        return images;
      }
    }

    // Check if there's an error
    if (history[promptId] && history[promptId].status?.status_str === 'error') {
      throw new AppError(`ComfyUI generation failed: ${history[promptId].status.error || 'Unknown error'}`, 500);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  throw new AppError('ComfyUI generation timed out', 504);
}

/**
 * Download image from ComfyUI
 * @param {string} filename - Image filename
 * @param {string} subfolder - Subfolder (optional)
 * @param {string} type - Type: 'output', 'input', 'temp'
 * @returns {Promise<Buffer>} - Image buffer
 */
export async function downloadImage(filename, subfolder = '', type = 'output') {
  const params = new URLSearchParams({ filename });
  if (subfolder) params.append('subfolder', subfolder);
  if (type) params.append('type', type);

  const response = await fetch(`${config.comfyuiBaseUrl}/view?${params}`, {
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new AppError(`Failed to download image: ${response.statusText}`, 500);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generate image using ComfyUI with Z-Image Turbo workflow
 * @param {string} prompt - Image generation prompt
 * @param {Object} options - { width, height, seed, steps, cfg }
 * @returns {Promise<{buffer: Buffer, mimeType: string, width: number, height: number, promptId: string}>}
 */
export async function generateImage(prompt, options = {}) {
  // Load base workflow
  const workflow = await loadWorkflow();

  // Inject parameters
  const modifiedWorkflow = injectWorkflowParams(workflow, prompt, options);

  // Submit to ComfyUI
  const clientId = `pu-gpt-${Date.now()}`;
  const { promptId } = await submitPrompt(modifiedWorkflow, clientId);

  // Wait for completion
  const images = await waitForCompletion(promptId);

  if (images.length === 0) {
    throw new AppError('No images generated', 500);
  }

  // Download first image
  const firstImage = images[0];
  const buffer = await downloadImage(firstImage.filename, firstImage.subfolder, firstImage.type);

  return {
    buffer,
    mimeType: 'image/png',
    width: options.width || config.imageGenDefaultWidth,
    height: options.height || config.imageGenDefaultHeight,
    promptId,
    seed: options.seed,
  };
}

/**
 * Cancel a running prompt
 * @param {string} promptId - Prompt ID to cancel
 */
export async function cancelPrompt(promptId) {
  await fetch(`${COMFYUI_API}/queue`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] }),
  });
}

/**
 * Interrupt current execution
 */
export async function interrupt() {
  await fetch(`${COMFYUI_API}/interrupt`, {
    method: 'POST',
  });
}
import fs from 'fs/promises';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Validates file type by magic bytes (not just extension/mimetype)
 * Returns { ext, mime } if valid, throws AppError if invalid
 */
export async function validateImageFile(buffer) {
  const type = await fileTypeFromBuffer(buffer);

  if (!type) {
    throw new AppError('Unable to determine file type', 400);
  }

  const allowedTypes = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  };

  if (!allowedTypes[type.mime]) {
    throw new AppError(`Unsupported file type: ${type.mime}. Allowed: PNG, JPEG, WebP, PDF`, 400);
  }

  if (buffer.length > config.maxImageUploadSize) {
    throw new AppError(`File size exceeds ${config.maxImageUploadSize / (1024 * 1024)}MB limit`, 400);
  }

  return {
    ext: allowedTypes[type.mime],
    mime: type.mime,
  };
}

/**
 * Sanitizes filename to prevent path traversal and special characters
 */
export function sanitizeFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const allowedExts = ['.png', '.jpg', '.jpeg', '.webp', '.pdf'];
  const safeExt = allowedExts.includes(ext) ? ext : '.bin';

  // Remove path traversal attempts and special chars
  const baseName = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100);

  return `${baseName}${safeExt}`;
}

/**
 * Generates a unique filename with UUID
 */
export function generateUniqueFilename(originalName) {
  const ext = path.extname(sanitizeFilename(originalName));
  return `${uuidv4()}${ext}`;
}

/**
 * Ensures directory exists
 */
export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Safely deletes a file (ignores ENOENT)
 */
export async function safeDeleteFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`Failed to delete temp file ${filePath}:`, err.message);
    }
  }
}

/**
 * Validates image dimensions from buffer (for generated images)
 */
export async function getImageDimensions(buffer) {
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !type.mime.startsWith('image/')) {
    return null;
  }

  // For PNG/JPEG/WebP, we could use sharp to get dimensions
  // But for now, return null - dimensions come from generation params
  return null;
}
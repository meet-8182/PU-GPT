import fs from 'fs/promises';
import path from 'path';
import { AppError } from '../middleware/errorHandler.js';

const BLOCKLIST_PATH = path.join(process.cwd(), 'src', 'utils', 'promptBlocklist.json');

let blocklistCache = null;
let blocklistMtime = 0;

/**
 * Loads the blocklist from JSON file
 * Supports hot-reload on file change
 */
async function loadBlocklist() {
  try {
    const stats = await fs.stat(BLOCKLIST_PATH);
    if (blocklistCache && stats.mtimeMs === blocklistMtime) {
      return blocklistCache;
    }
    const content = await fs.readFile(BLOCKLIST_PATH, 'utf-8');
    const data = JSON.parse(content);
    blocklistCache = data;
    blocklistMtime = stats.mtimeMs;
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Return default minimal blocklist if file doesn't exist
      return { patterns: [], exactWords: [] };
    }
    console.error('Failed to load prompt blocklist:', err);
    return { patterns: [], exactWords: [] };
  }
}

/**
 * Validates and sanitizes a prompt for image generation
 * Returns cleaned prompt or throws AppError
 */
export async function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new AppError('Prompt is required', 400);
  }

  const trimmed = prompt.trim();

  if (trimmed.length === 0) {
    throw new AppError('Prompt cannot be empty', 400);
  }

  if (trimmed.length > 2000) {
    throw new AppError('Prompt exceeds maximum length of 2000 characters', 400);
  }

  const blocklist = await loadBlocklist();

  // Check exact word matches (case-insensitive)
  const lowerPrompt = trimmed.toLowerCase();
  for (const word of blocklist.exactWords || []) {
    const regex = new RegExp(`\\b${escapeRegExp(word.toLowerCase())}\\b`);
    if (regex.test(lowerPrompt)) {
      throw new AppError('Prompt contains prohibited content', 400);
    }
  }

  // Check regex patterns
  for (const pattern of blocklist.patterns || []) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(trimmed)) {
        throw new AppError('Prompt contains prohibited content', 400);
      }
    } catch (regexErr) {
      console.warn('Invalid regex in blocklist:', pattern, regexErr.message);
    }
  }

  return trimmed;
}

/**
 * Escapes special regex characters
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Adds a word/pattern to the blocklist (admin only)
 * This is a simple file-based approach; could be extended to DB
 */
export async function addToBlocklist(type, value) {
  const blocklist = await loadBlocklist();
  if (type === 'exact') {
    if (!blocklist.exactWords.includes(value.toLowerCase())) {
      blocklist.exactWords.push(value.toLowerCase());
    }
  } else if (type === 'pattern') {
    if (!blocklist.patterns.includes(value)) {
      blocklist.patterns.push(value);
    }
  } else {
    throw new AppError('Invalid blocklist type', 400);
  }
  await fs.writeFile(BLOCKLIST_PATH, JSON.stringify(blocklist, null, 2));
  blocklistCache = null; // Force reload
  return blocklist;
}

/**
 * Gets current blocklist (admin only)
 */
export async function getBlocklist() {
  return loadBlocklist();
}
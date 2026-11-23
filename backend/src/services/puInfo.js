import crypto from 'crypto';
import { chroma, generateEmbeddings } from './ingestion.js';
import { UniversityInfo } from '../models/index.js';

/**
 * University-information retrieval for the pre-login guest chat.
 *
 * This module is intentionally separate from `ingestion.js`: it only ever reads
 * and writes the `pu_info` Chroma collection. Course material lives in a
 * different collection and is never queried from here.
 */
export const PU_INFO_COLLECTION = 'pu_info';

// Far-future sentinel for documents with no expiry date.
const NO_EXPIRY_TS = 4102444800000; // 2100-01-01T00:00:00Z
const DEFAULT_MAX_CHARS = 1200;
const MIN_CHUNK_CHARS = 80;

export const GUEST_TOP_K = 3;

async function getPuInfoCollection() {
  try {
    return await chroma.getCollection({ name: PU_INFO_COLLECTION });
  } catch {
    return await chroma.createCollection({ name: PU_INFO_COLLECTION });
  }
}

/**
 * Chroma filter for guest retrieval. Only approved, currently-valid documents
 * may be returned. Exported so it can be unit-tested without Chroma.
 */
export function buildGuestWhere(now = Date.now()) {
  return {
    $and: [
      { approved: { $eq: true } },
      { status: { $eq: 'approved' } },
      { validUntilTs: { $gte: now } },
      { effectiveFromTs: { $lte: now } },
    ],
  };
}

export function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isHeadingLine(line, nextLine) {
  const text = line.trim();
  if (!text) return false;
  if (/^#{1,6}\s+\S/.test(text)) return true;
  if (text.length > 80) return false;
  if (/[.!?;:,]$/.test(text)) return false;
  if (/^[-*•\d]/.test(text)) return false;
  // A short title-cased / upper-case line followed by a blank line is treated
  // as a section heading. This keeps headings as chunk boundaries.
  return /^[A-Z0-9][A-Za-z0-9 &/()'.,-]{2,79}$/.test(text)
    && (!nextLine || !nextLine.trim());
}

function splitLongText(text, maxChars) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pieces = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) {
      pieces.push(paragraph);
      continue;
    }
    // Split oversized paragraphs on sentence boundaries, then hard-wrap any
    // remaining oversized sentence.
    const sentences = paragraph.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [paragraph];
    let buffer = '';
    for (const sentence of sentences) {
      const part = sentence.trim();
      if (!part) continue;
      if ((buffer + ' ' + part).trim().length > maxChars && buffer) {
        pieces.push(buffer.trim());
        buffer = '';
      }
      if (part.length > maxChars) {
        for (let i = 0; i < part.length; i += maxChars) {
          pieces.push(part.slice(i, i + maxChars).trim());
        }
      } else {
        buffer = (buffer + ' ' + part).trim();
      }
    }
    if (buffer) pieces.push(buffer.trim());
  }

  return pieces.filter((p) => p.length >= MIN_CHUNK_CHARS || pieces.length === 1);
}

/**
 * Heading-aware chunking. Each heading starts a new chunk; long sections are
 * split on paragraph/sentence boundaries.
 */
export function chunkByHeadings(rawText, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  const text = normalizeWhitespace(rawText);
  if (!text) return [];

  const lines = text.split('\n');
  const sections = [];
  let heading = null;
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ heading, body });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isHeadingLine(line, lines[i + 1])) {
      flush();
      heading = line.trim().replace(/^#{1,6}\s+/, '');
      continue;
    }
    buffer.push(line);
  }
  flush();

  if (sections.length === 0) {
    return splitLongText(text, maxChars).map((piece, index) => ({
      text: piece,
      heading: null,
      chunkIndex: index,
    }));
  }

  const chunks = [];
  for (const section of sections) {
    const pieces = splitLongText(section.body, maxChars);
    if (pieces.length === 0) continue;
    for (const piece of pieces) {
      chunks.push({
        text: section.heading ? `${section.heading}\n${piece}` : piece,
        heading: section.heading,
        chunkIndex: chunks.length,
      });
    }
  }

  return chunks;
}

/**
 * Page-aware chunking for PDFs, falling back to whole-text chunking otherwise.
 */
export function chunkUniversityText(rawText, { pageTexts = null, maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (Array.isArray(pageTexts) && pageTexts.length > 0) {
    const chunks = [];
    for (const page of pageTexts) {
      const pageChunks = chunkByHeadings(page.text, { maxChars });
      for (const chunk of pageChunks) {
        chunks.push({
          ...chunk,
          page: page.page || 1,
          chunkIndex: chunks.length,
        });
      }
    }
    return chunks;
  }

  return chunkByHeadings(rawText, { maxChars }).map((chunk) => ({
    ...chunk,
    page: 1,
  }));
}

/**
 * Heuristic warning for PDFs where tables were flattened into unreadable text.
 * Returns a human-readable warning string or null.
 */
export function detectPoorTableExtraction(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 5) return null;

  const tableLike = lines.filter((line) => {
    const numbers = (line.match(/\d+/g) || []).length;
    const wideGaps = (line.match(/\s{2,}/g) || []).length;
    return (numbers >= 2 && wideGaps >= 1) || numbers >= 3;
  });

  if (tableLike.length / lines.length > 0.25) {
    return 'Possible table extraction issue: many numeric rows were flattened. Please check the PDF layout before approving.';
  }
  return null;
}

function toIso(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function metadataForChunk(doc, chunk) {
  const effectiveFrom = new Date(doc.effectiveFrom);
  const validUntil = doc.validUntil ? new Date(doc.validUntil) : null;
  const lastReviewed = new Date(doc.lastReviewed || Date.now());
  const chunkHash = hashString(chunk.text);

  return {
    documentId: doc._id.toString(),
    category: doc.category || 'other',
    title: doc.title || doc.sourceDoc || 'University information',
    version: Number(doc.version) || 1,
    effectiveFrom: toIso(effectiveFrom),
    validUntil: toIso(validUntil),
    lastReviewed: toIso(lastReviewed),
    approved: Boolean(doc.approved),
    status: doc.status || 'draft',
    sourceDoc: doc.sourceDoc || doc.title || 'University information',
    page: Number(chunk.page) || 1,
    chunkIndex: Number(chunk.chunkIndex) || 0,
    heading: chunk.heading || '',
    text: String(chunk.text).slice(0, 500),
    chunkHash,
    effectiveFromTs: effectiveFrom.getTime(),
    validUntilTs: validUntil ? validUntil.getTime() : NO_EXPIRY_TS,
    lastReviewedTs: lastReviewed.getTime(),
  };
}

export async function deleteUniversityInfoChunks(documentId) {
  const collection = await getPuInfoCollection();
  await collection.delete({ where: { documentId: String(documentId) } });
}

/**
 * Index (or re-index) one university-information document into `pu_info`.
 * Chunk hashes dedupe identical chunks within the document.
 */
export async function indexUniversityInfo(doc, { text, pageTexts = null } = {}) {
  if (!doc?._id) throw new Error('A university-information document is required');

  const body = text ?? doc.text ?? '';
  try {
    const chunks = chunkUniversityText(body, { pageTexts });
    if (chunks.length === 0) {
      throw new Error('No usable text could be extracted from this document');
    }

    // Deduplicate identical chunks inside this document.
    const seen = new Set();
    const uniqueChunks = [];
    for (const chunk of chunks) {
      const key = hashString(chunk.text);
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueChunks.push({ ...chunk, hash: key });
    }

    const collection = await getPuInfoCollection();
    await deleteUniversityInfoChunks(doc._id);

    const embeddings = await generateEmbeddings(uniqueChunks.map((chunk) => chunk.text));
    const ids = uniqueChunks.map((chunk) => `${doc._id}-${chunk.hash.slice(0, 24)}`);
    const metadatas = uniqueChunks.map((chunk) => metadataForChunk(doc, chunk));

    await collection.add({
      ids,
      embeddings,
      documents: uniqueChunks.map((chunk) => chunk.text),
      metadatas,
    });

    await UniversityInfo.findByIdAndUpdate(doc._id, {
      chunkCount: uniqueChunks.length,
      contentHash: hashString(body),
      errorMessage: null,
    });

    return { chunkCount: uniqueChunks.length };
  } catch (error) {
    await UniversityInfo.findByIdAndUpdate(doc._id, { errorMessage: error.message }).catch(() => {});
    throw error;
  }
}

export async function reindexUniversityInfo(doc) {
  return indexUniversityInfo(doc, { text: doc.text || '' });
}

/**
 * Retrieve approved, currently-valid university information. Never touches
 * course material.
 */
export async function searchPuInfo(query, { topK = GUEST_TOP_K, now = Date.now() } = {}) {
  const collection = await getPuInfoCollection();
  const queryEmbedding = await generateEmbeddings([query]);

  const results = await collection.query({
    queryEmbeddings: queryEmbedding,
    nResults: topK,
    where: buildGuestWhere(now),
  });

  if (!results?.documents?.[0]?.length) return [];

  const documents = results.documents[0];
  const metadatas = results.metadatas?.[0] || [];
  const distances = results.distances?.[0] || [];

  return documents.map((text, index) => {
    const distance = distances[index] ?? 0;
    return {
      text,
      metadata: metadatas[index] || {},
      score: Math.max(0, 1 - distance / 1000),
    };
  });
}

/**
 * Read the stored chunks for one document (used by the admin preview screen).
 */
export async function getUniversityInfoChunks(documentId) {
  const collection = await getPuInfoCollection();
  const result = await collection.get({ where: { documentId: String(documentId) } });
  const documents = result?.documents || [];
  const metadatas = result?.metadatas || [];
  return documents.map((text, index) => ({
    text,
    metadata: metadatas[index] || {},
  }));
}

export { getPuInfoCollection };

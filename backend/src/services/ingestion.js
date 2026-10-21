import { Document } from '../models/index.js';
import { config } from '../config/index.js';
import { ChromaClient } from 'chromadb';
import { Ollama } from 'ollama';
import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const ollama = new Ollama({ host: 'http://localhost:11434' });

const SUBJECT_CHUNK_CONFIG = {
  'Engineering': { chunkSize: 800, overlap: 100 },
  'Life Sciences': { chunkSize: 1500, overlap: 200 },
  'Business': { chunkSize: 1500, overlap: 200 },
  'Law': { chunkSize: 1800, overlap: 200 },
  'Creative': { chunkSize: 1800, overlap: 200 },
  'default': { chunkSize: 1500, overlap: 200 },
};

function getChunkConfig(subject) {
  if (SUBJECT_CHUNK_CONFIG[subject]) {
    return SUBJECT_CHUNK_CONFIG[subject];
  }
  
  for (const [category, config] of Object.entries(SUBJECT_CHUNK_CONFIG)) {
    if (subject.toLowerCase().includes(category.toLowerCase())) {
      return config;
    }
  }
  
  return SUBJECT_CHUNK_CONFIG.default;
}

function getSubjectCategory(subject) {
  const subjectToCategory = {
    'Computer Engineering': 'Engineering',
    'Computer Science': 'Engineering',
    'Information Technology': 'Engineering',
    'Electronics': 'Engineering',
    'Electrical': 'Engineering',
    'Mechanical': 'Engineering',
    'Civil': 'Engineering',
    'Chemical': 'Engineering',
    'Biotechnology': 'Life Sciences',
    'Pharmacy': 'Life Sciences',
    'Microbiology': 'Life Sciences',
    'Pharmacology': 'Life Sciences',
    'Business Administration': 'Business',
    'Commerce': 'Business',
    'Management': 'Business',
    'Law': 'Law',
    'Legal Studies': 'Law',
    'Fine Arts': 'Creative',
    'Design': 'Creative',
    'Architecture': 'Creative',
    'Literature': 'Creative',
    'Humanities': 'Creative',
  };
  
  return subjectToCategory[subject] || 'Engineering';
}

export const chroma = new ChromaClient({ path: config.chromaUrl });
const COLLECTION_NAME = 'pu-gpt-documents';

async function getCollection() {
  try {
    return await chroma.getCollection({ name: COLLECTION_NAME });
  } catch {
    return await chroma.createCollection({ name: COLLECTION_NAME });
  }
}

function chunkText(text, options = {}) {
  const subject = options?.subject;
  const pageTexts = options?.pageTexts; // Array of {page, text} for page-aware chunking
  const config = getChunkConfig(subject);
  const { chunkSize = config.chunkSize, overlap = config.overlap } = options;
  const chunks = [];

  if (!text || text.length === 0) {
    return chunks;
  }

  // Remove maxTextLength truncation - process full document
  // const maxTextLength = 50000;
  // if (text.length > maxTextLength) {
  //   text = text.slice(0, maxTextLength);
  // }

  const maxChunks = 2000; // Increased from 1000

  // If we have pageTexts, do page-aware chunking
  if (pageTexts && pageTexts.length > 0) {
    let globalChunkIndex = 0;

    for (const pageData of pageTexts) {
      const pageNum = pageData.page;
      const pageText = pageData.text;
      let start = 0;
      let prevStart = -1;

      while (start < pageText.length && chunks.length < maxChunks) {
        if (start <= prevStart) break;
        prevStart = start;

        let end = Math.min(start + chunkSize, pageText.length);

        if (end < pageText.length) {
          const lastPeriod = pageText.lastIndexOf('.', end);
          const lastNewline = pageText.lastIndexOf('\n', end);
          const breakPoint = Math.max(lastPeriod, lastNewline);
          if (breakPoint > start + chunkSize * 0.5) {
            end = breakPoint + 1;
          }
        }

        if (end <= start) {
          end = Math.min(start + chunkSize, pageText.length);
        }
        if (end <= start) break;

        const chunk = pageText.slice(start, end).trim();
        if (chunk.length > 50) {
          chunks.push({
            text: chunk,
            page: pageNum,
            chunkIndex: globalChunkIndex++,
          });
        }

        const nextStart = end - overlap;
        start = nextStart <= start ? start + chunkSize : nextStart;

        if (start >= pageText.length || start < 0) break;
      }
    }

    return chunks;
  }

  // Fallback: simple chunking without page info (for backward compatibility)
  let start = 0;
  let prevStart = -1;
  let chunkIndex = 0;

  while (start < text.length && chunks.length < maxChunks) {
    if (start <= prevStart) break;
    prevStart = start;

    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      if (breakPoint > start + chunkSize * 0.5) {
        end = breakPoint + 1;
      }
    }

    if (end <= start) {
      end = Math.min(start + chunkSize, text.length);
    }
    if (end <= start) break;

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) {
      chunks.push({
        text: chunk,
        page: chunkIndex + 1, // Approximate page from chunk index
        chunkIndex: chunkIndex++,
      });
    }

    const nextStart = end - overlap;
    start = nextStart <= start ? start + chunkSize : nextStart;

    if (start >= text.length || start < 0) break;
  }

  return chunks;
}

// Timeout wrapper to prevent indefinite hanging
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function extractText(filePath, fileType) {
  if (filePath === 'teacher-response') {
    throw new Error('Teacher response should use processDocumentWithText');
  }

  const buffer = await fs.readFile(filePath);

  if (fileType === 'application/pdf') {
    // Use pdfjs-dist for page-level extraction
    try {
      const pdfData = new Uint8Array(buffer);
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdfDoc = await loadingTask.promise;

      const pageTexts = [];
      let fullText = '';

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();

        const pageText = textContent.items
          .map(item => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        pageTexts.push({ page: i, text: pageText });
        fullText += `\n\n--- PAGE ${i} ---\n${pageText}`;
      }

      return { text: fullText.trim(), pageTexts };
    } catch (error) {
      console.warn('[Ingestion] pdfjs-dist failed, falling back to pdf-parse:', error.message);
      // Fallback to pdf-parse
      const data = await withTimeout(pdfParse(buffer), 60000, 'PDF parsing');
      const pageTexts = [];
      const roughPages = data.text.split('\n\n').filter(t => t.trim().length > 0);
      roughPages.forEach((t, idx) => pageTexts.push({ page: idx + 1, text: t }));
      return { text: data.text, pageTexts };
    }
  }

  if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await withTimeout(mammoth.extractRawText({ buffer }), 60000, 'DOCX parsing');
    return { text: result.value, pageTexts: [{ page: 1, text: result.value }] };
  }

  if (fileType === 'text/plain') {
    const text = buffer.toString('utf-8');
    return { text, pageTexts: [{ page: 1, text }] };
  }

  throw new Error(`Unsupported file type: ${fileType}`);
}

// Retry wrapper for transient failures
async function withRetry(promiseFn, retries = 3, delayMs = 1000, label = 'Operation') {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await promiseFn();
    } catch (error) {
      if (attempt === retries) throw error;
      console.warn(`${label} attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function generateEmbeddings(texts) {
  const embeddings = [];
  for (const text of texts) {
    // Add timeout for each embedding (30 seconds) with retry
    const response = await withRetry(
      () => withTimeout(
        ollama.embeddings({ model: 'bge-m3', prompt: text }),
        30000,
        'Embedding generation'
      ),
      3,
      1000,
      'Embedding generation'
    );
    embeddings.push(response.embedding);
  }
  return embeddings;
}

export async function processDocumentWithText(documentId, text, pageTexts = null) {
  let document = await Document.findById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  try {
    // Pass pageTexts for page-aware chunking
    const chunks = chunkText(text, { subject: document.subject, pageTexts });

    if (chunks.length === 0) {
      throw new Error('No valid chunks extracted from document');
    }

    // Extract text for embeddings (chunks are now objects with .text property)
    const chunkTexts = chunks.map(c => c.text);
    const embeddings = await generateEmbeddings(chunkTexts);

    const collection = await getCollection();

    const ids = chunks.map((_, i) => `${documentId}-${i}`);
    const filename = document.title || `teacher-response-${documentId}`;
    const metadatas = chunks.map((chunk, i) => ({
      documentId: documentId.toString(),
      college: document.college,
      department: document.department,
      subject: document.subject,
      semester: document.semester,
      unit: document.unit || '',
      chunkIndex: chunk.chunkIndex ?? i,
      sourceDoc: filename,
      page: chunk.page ?? (i + 1),
      text: chunk.text.slice(0, 500),
    }));

    await collection.add({
      ids,
      embeddings,
      documents: chunkTexts,
      metadatas,
    });

    document.status = 'indexed';
    document.chunkCount = chunks.length;
    document.indexedAt = new Date();
    await document.save();

    console.log(`Document ${documentId} indexed with ${chunks.length} chunks`);
  } catch (error) {
    document.status = 'failed';
    document.errorMessage = error.message;
    await document.save();
    throw error;
  }
}

export async function deleteDocumentChunks(documentId) {
  const collection = await getCollection();
  try {
    await collection.delete({
      where: { documentId: documentId.toString() },
    });
    console.log(`Deleted chunks for document ${documentId}`);
  } catch (error) {
    console.error(`Error deleting chunks for document ${documentId}:`, error);
    throw error;
  }
}

export async function processDocument(documentId) {
  let document = await Document.findById(documentId);
  if (!document) {
    throw new Error('Document not found');
  }

  try {
    const { text, pageTexts } = await extractText(document.fileUrl, document.fileType);
    const chunks = chunkText(text, { subject: document.subject, pageTexts });

    if (chunks.length === 0) {
      throw new Error('No valid chunks extracted from document');
    }

    const chunkTexts = chunks.map(c => c.text);
    const embeddings = await generateEmbeddings(chunkTexts);

    const collection = await getCollection();

    const ids = chunks.map((_, i) => `${documentId}-${i}`);
    const filename = document.title || `doc-${documentId}`;
    const metadatas = chunks.map((chunk, i) => ({
      documentId: documentId.toString(),
      college: document.college,
      department: document.department,
      subject: document.subject,
      semester: document.semester,
      unit: document.unit || '',
      chunkIndex: chunk.chunkIndex ?? i,
      sourceDoc: filename,
      page: chunk.page ?? (i + 1),
      text: chunk.text.slice(0, 500),
    }));

    await collection.add({
      ids,
      embeddings,
      documents: chunkTexts,
      metadatas,
    });

    document.status = 'indexed';
    document.chunkCount = chunks.length;
    document.indexedAt = new Date();
    await document.save();

    console.log(`Document ${documentId} indexed with ${chunks.length} chunks`);
  } catch (error) {
    document.status = 'failed';
    document.errorMessage = error.message;
    await document.save();
    throw error;
  }
}

export async function searchChunks(query, filters = {}, topK = 6) {
  const collection = await getCollection();
  
  const whereConditions = [];
  if (filters.college) whereConditions.push({ college: { $eq: filters.college } });
  if (filters.department) whereConditions.push({ department: { $eq: filters.department } });
  if (filters.subject) whereConditions.push({ subject: { $eq: filters.subject } });
  if (filters.semester) whereConditions.push({ semester: { $eq: filters.semester } });

  const where = whereConditions.length === 1 ? whereConditions[0] : 
                whereConditions.length > 1 ? { $and: whereConditions } : {};

  const queryEmbedding = await generateEmbeddings([query]);
  
  const results = await collection.query({
    queryEmbeddings: queryEmbedding,
    nResults: topK,
    where: whereConditions.length > 0 ? where : undefined,
  });

  if (!results.documents || !results.documents[0] || results.documents[0].length === 0) {
    return [];
  }

  const documents = results.documents[0];
  const metadatas = results.metadatas[0];
  const distances = results.distances[0];

  return documents.map((text, i) => {
    const distance = distances[i];
    // Convert Euclidean distance to similarity score (0-1 range)
    // For normalized embeddings, max distance is ~2, but actual distances can be larger
    const score = Math.max(0, 1 - distance / 1000);
    return {
      text,
      metadata: metadatas[i],
      score,
    };
  });
}
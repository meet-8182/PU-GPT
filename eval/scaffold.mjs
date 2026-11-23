#!/usr/bin/env node
/**
 * eval/scaffold.js
 * Samples chunks from the vector store for a subject and uses the local model
 * to draft one question per chunk with an anchor phrase copied from that chunk.
 * Outputs drafts to eval/drafts.csv for human review.
 * 
 * Usage: node eval/scaffold.js --subject "Data Structures" --count 60
 */

import { program } from 'commander';
import { Document } from '../backend/src/models/index.js';
import { chroma, getCollection } from '../backend/src/services/ingestion.js';
import { ollama } from '../backend/src/services/ingestion.js';
import fs from 'fs';
import path from 'path';

program
  .requiredOption('-s, --subject <subject>', 'Subject name (e.g., "Data Structures")')
  .option('-c, --count <count>', 'Number of questions to draft', '60')
  .option('-o, --output <file>', 'Output CSV file', 'eval/drafts.csv')
  .parse();

const opts = program.opts();
const subject = opts.subject;
const count = parseInt(opts.count, 10);
const outputFile = opts.output;

const LLM_MODEL = 'qwen2.5:3b-instruct-q4_K_M';

async function main() {
  console.log(`[Scaffold] Subject: ${subject}, Count: ${count}`);
  
  // Get document IDs for this subject
  const docs = await Document.find({ subject, status: 'indexed' }).lean();
  const docIds = docs.map(d => d._id.toString());
  console.log(`[Scaffold] Found ${docIds.length} indexed documents`);
  
  if (docIds.length === 0) {
    console.error('No indexed documents found for this subject');
    process.exit(1);
  }

  const collection = await getCollection();
  
  // Get all chunks for these documents
  const allChunks = [];
  const batchSize = 100;
  
  for (let i = 0; i < docIds.length; i += batchSize) {
    const batch = docIds.slice(i, i + batchSize);
    const results = await collection.get({
      where: { documentId: { $in: batch } },
      include: ['documents', 'metadatas'],
    });
    
    if (results.documents && results.documents.length > 0) {
      for (let j = 0; j < results.documents.length; j++) {
        allChunks.push({
          text: results.documents[j],
          metadata: results.metadatas[j],
        });
      }
    }
  }
  
  console.log(`[Scaffold] Retrieved ${allChunks.length} total chunks`);
  
  if (allChunks.length === 0) {
    console.error('No chunks found');
    process.exit(1);
  }
  
  // Sample chunks evenly across the subject
  const step = Math.max(1, Math.floor(allChunks.length / count));
  const sampledChunks = [];
  for (let i = 0; i < sampledChunks.length < count && i < allChunks.length; i += step) {
    sampledChunks.push(allChunks[i]);
  }
  
  // If we need more, add random ones
  while (sampledChunks.length < count && sampledChunks.length < allChunks.length) {
    const idx = Math.floor(Math.random() * allChunks.length);
    if (!sampledChunks.includes(allChunks[idx])) {
      sampledChunks.push(allChunks[idx]);
    }
  }
  
  console.log(`[Scaffold] Sampled ${sampledChunks.length} chunks`);
  
  // Generate questions using the model
  const drafts = [];
  
  for (let i = 0; i < sampledChunks.length; i++) {
    const chunk = sampledChunks[i];
    const text = chunk.text.slice(0, 2000); // Limit for prompt
    
    const prompt = `You are a teaching assistant creating evaluation questions for a course on ${subject}.

Given this excerpt from course material, create ONE clear question that a student might ask, and extract an anchor phrase (5-12 words) from the text that the correct answer must contain.

Excerpt:
${text}

Source document: ${chunk.metadata.sourceDoc || 'unknown'}, page: ${chunk.metadata.page || 'N/A'}

Output format (JSON only):
{
  "question": "student question here",
  "anchor": "anchor phrase copied exactly from text",
  "type": "definition|concept|code|multipart",
  "mustMention": ["key", "terms", "here"]
}`;

    try {
      const response = await ollama.chat({
        model: LLM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        options: { temperature: 0.3, num_predict: 500 },
        stream: false,
      });
      
      let parsed;
      try {
        parsed = JSON.parse(response.message.content);
      } catch (e) {
        // Try to extract JSON from markdown
        const match = response.message.content.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
        else throw e;
      }
      
      drafts.push({
        id: `${subject.toLowerCase().replace(/\s+/g, '-')}-${String(i + 1).padStart(3, '0')}`,
        subjectId: subject,
        type: parsed.type || 'concept',
        turns: [parsed.question],
        answerable: true,
        expected: {
          anchors: [parsed.anchor],
          doc: chunk.metadata.sourceDoc || 'unknown',
          pages: [chunk.metadata.page || 'N/A'],
        },
        mustMention: parsed.mustMention || [],
        mustNotMention: [],
        source: 'synthetic',
        notes: '',
        keep: '',
      });
      
      console.log(`[Scaffold] ${i + 1}/${sampledChunks.length}: ${parsed.question}`);
    } catch (err) {
      console.error(`[Scaffold] Failed on chunk ${i}:`, err.message);
    }
  }
  
  // Write CSV
  const headers = ['id', 'subjectId', 'type', 'turns', 'answerable', 'expected', 'mustMention', 'mustNotMention', 'source', 'notes', 'keep'];
  const rows = drafts.map(d => [
    d.id,
    d.subjectId,
    d.type,
    JSON.stringify(d.turns),
    d.answerable,
    JSON.stringify(d.expected),
    JSON.stringify(d.mustMention),
    JSON.stringify(d.mustNotMention),
    d.source,
    d.notes,
    d.keep,
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  
  const csv = [headers.join(','), ...rows].join('\n');
  fs.writeFileSync(outputFile, csv);
  console.log(`[Scaffold] Wrote ${drafts.length} drafts to ${outputFile}`);
}

main().catch(err => {
  console.error('[Scaffold] Error:', err);
  process.exit(1);
});
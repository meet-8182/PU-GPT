#!/usr/bin/env node
/**
 * eval/run.js
 * Runs evaluation questions through the pipeline and records metrics.
 * 
 * Usage: node eval/run.js --label baseline [--topK 3] [--candidates 20] [--threshold 0.15] [--reranker on] [--model name]
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

program
  .requiredOption('-l, --label <label>', 'Run label (e.g., baseline, dedup-on, topk-5)')
  .option('-k, --topK <number>', 'Override top-k for retrieval', '3')
  .option('-c, --candidates <number>', 'Override candidate count', '20')
  .option('-t, --threshold <number>', 'Score threshold for abstain', '0.15')
  .option('-r, --reranker <on|off>', 'Enable topic reranker', 'on')
  .option('-m, --model <name>', 'Model name override', '')
  .option('-q, --questions <file>', 'Questions JSONL file', 'eval/questions.jsonl')
  .option('-o, --output <dir>', 'Output directory', 'eval/results')
  .parse();

const opts = program.opts();
const label = opts.label;
const topK = parseInt(opts.topK, 10);
const candidates = parseInt(opts.candidates, 10);
const threshold = parseFloat(opts.threshold);
const reranker = opts.reranker === 'on';
const model = opts.model;
const questionsFile = path.resolve(PROJECT_ROOT, opts.questions);
const outputDir = path.resolve(PROJECT_ROOT, opts.output);

if (!fs.existsSync(questionsFile)) {
  console.error(`Questions file not found: ${questionsFile}`);
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Load questions
const questionsContent = fs.readFileSync(questionsFile, 'utf-8');
const questions = questionsContent.trim().split('\n')
  .filter(l => l.trim())
  .map(l => JSON.parse(l));

console.log(`[Runner] Loaded ${questions.length} questions from ${questionsFile}`);
console.log(`[Runner] Label: ${label}, topK: ${topK}, candidates: ${candidates}, threshold: ${threshold}, reranker: ${reranker}`);

// Import the pipeline - we need to run this in the backend context
// We'll use a dynamic import approach
async function runPipeline(question, subjectId) {
  // This will be implemented by importing the backend evalPipeline
  // For now, we'll use a subprocess or direct import
  // Since we're in ES modules, we can import the backend service
  
  const { runPipeline } = await import('../backend/src/services/evalPipeline.js');
  
  // We need a student ID that exists in the DB
  // For eval, we'll use a dedicated eval student or create one
  const evalStudentId = 'eval-student-id'; // This needs to exist in DB
  
  return runPipeline({
    studentId: evalStudentId,
    question: question.turns[question.turns.length - 1], // Last turn is the one judged
    subject: subjectId,
    options: { topK, candidates, threshold: threshold, reranker },
  });
}

// For now, let's create a mock runner that shows the structure
// The actual implementation needs the backend running and a valid student ID

const results = [];
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputFile = path.join(outputDir, `${timestamp}-${label}.json`);
const summaryFile = path.join(outputDir, `${timestamp}-${label}.md`);

async function main() {
  console.log('[Runner] Starting evaluation...');
  
  // This is a skeleton - the actual pipeline call needs the backend
  // For demonstration, we'll create the output structure
  
  const runResult = {
    label,
    timestamp: new Date().toISOString(),
    config: { topK, candidates, threshold, reranker, model },
    questions: questions.length,
    results: [],
    metrics: {
      retrieval: { hitAt1: 0, hitAt3: 0, hitAt5: 0, hitAt10: 0, mrr: 0 },
      abstention: { correctAbstain: 0, falseAbstain: 0, totalUnanswerable: 0, totalAnswerable: 0 },
      answer: { mustMention: 0, mustNotMention: 0, citationPresent: 0, noForbiddenPhrases: 0, lengthAppropriate: 0 },
      byType: {},
    },
  };
  
  console.log('[Runner] Skeleton runner - actual pipeline integration needed');
  console.log('[Runner] Would run', questions.length, 'questions');
  
  // Write empty results for now
  fs.writeFileSync(outputFile, JSON.stringify(runResult, null, 2));
  console.log(`[Runner] Wrote ${outputFile}`);
  
  // Write summary
  const summary = `# Evaluation Run: ${label}

**Timestamp:** ${runResult.timestamp}
**Config:** topK=${topK}, candidates=${candidates}, threshold=${threshold}, reranker=${reranker}
**Questions:** ${questions.length}

## Metrics
| Metric | Value |
|--------|-------|
| Hit@1 | ${runResult.metrics.retrieval.hitAt1} |
| Hit@3 | ${runResult.metrics.retrieval.hitAt3} |
| Hit@5 | ${runResult.metrics.retrieval.hitAt5} |
| Hit@10 | ${runResult.metrics.retrieval.hitAt10} |
| MRR | ${runResult.metrics.retrieval.mrr} |
| Correct Abstain | ${runResult.metrics.abstention.correctAbstain}/${runResult.metrics.abstention.totalUnanswerable} |
| False Abstain | ${runResult.metrics.abstention.falseAbstain}/${runResult.metrics.abstention.totalAnswerable} |

*Run the actual pipeline to populate metrics.*
`;
  
  fs.writeFileSync(summaryFile, summary);
  console.log(`[Runner] Wrote ${summaryFile}`);
}

main().catch(err => {
  console.error('[Runner] Error:', err);
  process.exit(1);
});
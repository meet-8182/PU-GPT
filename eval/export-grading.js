#!/usr/bin/env node
/**
 * eval/export-grading.js
 * Exports a CSV of sampled answers for human grading.
 * 
 * Usage: node eval/export-grading.js --results eval/results/<file>.json --output eval/grading.csv --sample 30
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

program
  .requiredOption('-r, --results <file>', 'Results JSON file from eval/run.js')
  .option('-o, --output <file>', 'Output CSV file', 'eval/grading.csv')
  .option('-s, --sample <number>', 'Number of answers to sample', '30')
  .parse();

const opts = program.opts();
const resultsFile = path.resolve(PROJECT_ROOT, opts.results);
const outputFile = path.resolve(PROJECT_ROOT, opts.output);
const sampleSize = parseInt(opts.sample, 10);

if (!fs.existsSync(resultsFile)) {
  console.error(`Results file not found: ${resultsFile}`);
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

// Get answerable questions with answers
const answerable = results.results.filter(r => 
  r.questionData?.answerable !== false && r.answer
);

// Sample randomly
const shuffled = [...answerable].sort(() => Math.random() - 0.5);
const sampled = shuffled.slice(0, Math.min(sampleSize, answerable.length));

const headers = ['question_id', 'question', 'answer', 'correct', 'grounded', 'clear', 'notes'];
const rows = sampled.map(r => {
  const question = r.questionData.turns[r.questionData.turns.length - 1];
  const answer = r.answer || '';
  return [
    r.questionData.id,
    `"${question.replace(/"/g, '""')}"`,
    `"${answer.replace(/"/g, '""').slice(0, 500)}"`,
    '', // correct (0, 1, 2)
    '', // grounded (0, 1)
    '', // clear (0, 1)
    '',
  ].join(',');
});

const csv = [headers.join(','), ...rows].join('\n');
fs.writeFileSync(outputFile, csv);
console.log(`Exported ${sampled.length} answers to ${outputFile}`);
console.log('Grade each row: correct (0=wrong, 1=partial, 2=correct), grounded (0/1), clear (0/1)');
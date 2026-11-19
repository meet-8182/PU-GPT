#!/usr/bin/env node
/**
 * eval/import-grading.js
 * Reads graded CSV and adds averages to the results summary.
 * 
 * Usage: node eval/import-grading.js --results eval/results/<file>.json --grading eval/grading.csv
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

program
  .requiredOption('-r, --results <file>', 'Results JSON file')
  .requiredOption('-g, --grading <file>', 'Graded CSV file')
  .parse();

const opts = program.opts();
const resultsFile = path.resolve(PROJECT_ROOT, opts.results);
const gradingFile = path.resolve(PROJECT_ROOT, opts.grading);

if (!fs.existsSync(resultsFile)) {
  console.error(`Results file not found: ${resultsFile}`);
  process.exit(1);
}
if (!fs.existsSync(gradingFile)) {
  console.error(`Grading file not found: ${gradingFile}`);
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
const gradingContent = fs.readFileSync(gradingFile, 'utf-8');

// Parse CSV
const lines = gradingContent.trim().split('\n');
const headers = lines[0].split(',').map(h => h.trim());
const rows = [];

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  
  const fields = [];
  let current = '';
  let inQuotes = false;
  
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === '"') {
      if (inQuotes && line[j + 1] === '"') {
        current += '"';
        j++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  
  if (fields.length >= headers.length) {
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = fields[idx].replace(/^"|"$/g, '').trim();
    });
    rows.push(row);
  }
}

// Map by question_id
const grades = {};
for (const row of rows) {
  grades[row.question_id] = {
    correct: parseInt(row.correct) || 0,
    grounded: parseInt(row.grounded) || 0,
    clear: parseInt(row.clear) || 0,
  };
}

// Add to results
let correctSum = 0, groundedSum = 0, clearSum = 0, count = 0;
for (const r of results.results) {
  if (grades[r.questionData.id]) {
    r.humanGrade = grades[r.questionData.id];
    correctSum += grades[r.questionData.id].correct;
    groundedSum += grades[r.questionData.id].grounded;
    clearSum += grades[r.questionData.id].clear;
    count++;
  }
}

results.humanGrading = {
  sampleSize: count,
  avgCorrect: count > 0 ? correctSum / count / 2 : 0, // normalize to 0-1
  avgGrounded: count > 0 ? groundedSum / count : 0,
  avgClear: count > 0 ? clearSum / count : 0,
};

fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
console.log(`Updated ${resultsFile} with human grading:`);
console.log(`  Avg Correct: ${(results.humanGrading.avgCorrect * 100).toFixed(1)}%`);
console.log(`  Avg Grounded: ${(results.humanGrading.avgGrounded * 100).toFixed(1)}%`);
console.log(`  Avg Clear: ${(results.humanGrading.avgClear * 100).toFixed(1)}%`);

// Also update the summary .md file
const summaryFile = resultsFile.replace('.json', '.md');
if (fs.existsSync(summaryFile)) {
  let summary = fs.readFileSync(summaryFile, 'utf-8');
  const gradingSection = `
## Human Grading (${count} samples)
| Metric | Score |
|--------|-------|
| Correct | ${(results.humanGrading.avgCorrect * 100).toFixed(1)}% |
| Grounded | ${(results.humanGrading.avgGrounded * 100).toFixed(1)}% |
| Clear | ${(results.humanGrading.avgClear * 100).toFixed(1)}% |
`;
  summary = summary.replace(/## Human Grading.*/, '') + '\n' + gradingSection;
  fs.writeFileSync(summaryFile, summary);
  console.log(`Updated ${summaryFile}`);
}
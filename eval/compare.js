#!/usr/bin/env node
/**
 * eval/compare.js
 * Compares two evaluation runs and shows metric changes.
 * 
 * Usage: node eval/compare.js eval/results/a.json eval/results/b.json
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

program
  .requiredOption('-a, --a <file>', 'First results file (baseline)')
  .requiredOption('-b, --b <file>', 'Second results file (new)')
  .parse();

const opts = program.opts();
const fileA = path.resolve(PROJECT_ROOT, opts.a);
const fileB = path.resolve(PROJECT_ROOT, opts.b);

if (!fs.existsSync(fileA)) { console.error(`File not found: ${fileA}`); process.exit(1); }
if (!fs.existsSync(fileB)) { console.error(`File not found: ${fileB}`); process.exit(1); }

const a = JSON.parse(fs.readFileSync(fileA, 'utf-8'));
const b = JSON.parse(fs.readFileSync(fileB, 'utf-8'));

function diff(valA, valB, precision = 3) {
  const diff = valB - valA;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(precision)} (${valA.toFixed(precision)} → ${valB.toFixed(precision)})`;
}

function diffPct(valA, valB) {
  const diff = valB - valA;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${(diff * 100).toFixed(1)}%`;
}

console.log(`\n=== Comparison: ${path.basename(fileA)} vs ${path.basename(fileB)} ===\n`);

console.log('--- Retrieval Metrics ---');
for (const key of ['hitAt1', 'hitAt3', 'hitAt5', 'hitAt10', 'mrr', 'duplicateRate', 'offTopicRate']) {
  const aVal = a.metrics?.retrieval?.[key] ?? 0;
  const bVal = b.metrics?.retrieval?.[key] ?? 0;
  console.log(`  ${key}: ${diff(aVal, bVal)}  ${diffPct(aVal, bVal)}`);
}

console.log('\n--- Abstention Metrics ---');
for (const key of ['correctAbstainRate', 'falseAbstainRate']) {
  const aVal = a.metrics?.abstention?.[key] ?? 0;
  const bVal = b.metrics?.abstention?.[key] ?? 0;
  console.log(`  ${key}: ${diffPct(aVal, bVal)}`);
}

console.log('\n--- Answer Quality ---');
for (const key of ['mustMention', 'mustNotMention', 'citationPresent', 'noForbiddenPhrases', 'lengthAppropriate']) {
  const aVal = a.metrics?.answer?.[key] ?? 0;
  const bVal = b.metrics?.answer?.[key] ?? 0;
  console.log(`  ${key}: ${diffPct(aVal, bVal)}`);
}

console.log('\n--- Per-Type Hit@3 ---');
const types = new Set([...Object.keys(a.metrics?.byType || {}), ...Object.keys(b.metrics?.byType || {})]);
for (const type of types) {
  const aVal = a.metrics?.byType?.[type]?.hitAt3 / (a.metrics?.byType?.[type]?.total || 1) || 0;
  const bVal = b.metrics?.byType?.[type]?.hitAt3 / (b.metrics?.byType?.[type]?.total || 1) || 0;
  console.log(`  ${type}: ${diffPct(aVal, bVal)}`);
}

// Find flipped questions
function getQuestionKey(r) {
  return r.questionData?.id;
}

const aMap = new Map(a.results.map(r => [getQuestionKey(r), r]));
const bMap = new Map(b.results.map(r => [getQuestionKey(r), r]));

const allKeys = new Set([...aMap.keys(), ...bMap.keys()]);

console.log('\n--- Flipped Questions (Hit@3) ---');
let flipped = 0;
for (const key of allKeys) {
  const aHit = aMap.get(key)?.metrics?.retrieval?.hitAt3 ?? false;
  const bHit = bMap.get(key)?.metrics?.retrieval?.hitAt3 ?? false;
  // We need to compute hitAt3 from the result
  // Actually we need to check from the raw results
}

console.log('\nDone.');
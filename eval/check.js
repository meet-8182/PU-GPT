#!/usr/bin/env node
/**
 * eval/check.js
 * Checks if current run meets baseline thresholds.
 * Exits with error code if metrics drop more than 3 points.
 * 
 * Usage: node eval/check.js --current eval/results/latest.json --baseline eval/baseline.json
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

program
  .requiredOption('-c, --current <file>', 'Current results file')
  .requiredOption('-b, --baseline <file>', 'Baseline results file')
  .option('-t, --threshold <number>', 'Max allowed drop in points (default 3)', '3')
  .parse();

const opts = program.opts();
const currentFile = path.resolve(PROJECT_ROOT, opts.current);
const baselineFile = path.resolve(PROJECT_ROOT, opts.baseline);
const threshold = parseFloat(opts.threshold);

if (!fs.existsSync(currentFile)) { console.error(`Current file not found: ${currentFile}`); process.exit(1); }
if (!fs.existsSync(baselineFile)) { console.error(`Baseline file not found: ${baselineFile}`); process.exit(1); }

const current = JSON.parse(fs.readFileSync(currentFile, 'utf-8'));
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));

function checkMetric(name, currentVal, baselineVal, higherIsBetter = true) {
  const drop = higherIsBetter ? baselineVal - currentVal : currentVal - baselineVal;
  if (drop > threshold) {
    console.error(`❌ ${name}: dropped ${drop.toFixed(3)} points (baseline: ${baselineVal.toFixed(3)}, current: ${currentVal.toFixed(3)}) - THRESHOLD ${threshold} EXCEEDED`);
    return false;
  } else if (drop > 0) {
    console.warn(`⚠️  ${name}: dropped ${drop.toFixed(3)} points (baseline: ${baselineVal.toFixed(3)}, current: ${currentVal.toFixed(3)})`);
    return true;
  } else {
    console.log(`✅ ${name}: ${currentVal.toFixed(3)} (baseline: ${baselineVal.toFixed(3)})`);
    return true;
  }
}

let passed = true;

console.log(`\n=== Check: ${path.basename(currentFile)} vs ${path.basename(baselineFile)} ===`);
console.log(`Threshold: ${threshold} points\n`);

// Hit@3
passed &= checkMetric('Hit@3', current.metrics?.retrieval?.hitAt3 ?? 0, baseline.metrics?.retrieval?.hitAt3 ?? 0);

// Correct abstain rate
passed &= checkMetric('Correct Abstain Rate', current.metrics?.abstention?.correctAbstainRate ?? 0, baseline.metrics?.abstention?.correctAbstainRate ?? 0);

// False abstain rate (lower is better)
passed &= checkMetric('False Abstain Rate', current.metrics?.abstention?.falseAbstainRate ?? 0, baseline.metrics?.abstention?.falseAbstainRate ?? 0, false);

// MRR
passed &= checkMetric('MRR', current.metrics?.retrieval?.mrr ?? 0, baseline.metrics?.retrieval?.mrr ?? 0);

// Answer quality
passed &= checkMetric('Must Mention', current.metrics?.answer?.mustMention ?? 0, baseline.metrics?.answer?.mustMention ?? 0);
passed &= checkMetric('Citation Present', current.metrics?.answer?.citationPresent ?? 0, baseline.metrics?.answer?.citationPresent ?? 0);

console.log(`\n=== Result: ${passed ? 'PASSED' : 'FAILED'} ===`);

if (!passed) {
  console.error('\nOne or more metrics dropped more than', threshold, 'points against baseline.');
  process.exit(1);
} else {
  console.log('\nAll metrics within threshold.');
  process.exit(0);
}
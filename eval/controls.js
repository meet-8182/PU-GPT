#!/usr/bin/env node
/**
 * eval/controls.js
 * Runs the three controls to prove the harness works.
 * 
 * Usage: node eval/controls.js
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// This script documents the three controls. Actual implementation
// requires running the pipeline with specific configurations.

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    EVALUATION HARNESS CONTROLS                     ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  1. NEGATIVE CONTROL - Random Retrieval                           ║
║     - Configure retrieval to return random chunks                 ║
║     - Expected: Hit@3 ≈ 0%                                         ║
║     - Implementation: Set random seed in searchChunks             ║
║                                                                    ║
║  2. POSITIVE CONTROL - Injected Anchor                            ║
║     - For each question, inject the chunk containing its anchor   ║
║     - Expected: Hit@3 = 100%                                       ║
║     - Implementation: Prepend anchor chunk to retrieval results   ║
║                                                                    ║
║  3. REPEATABILITY - Same Config Twice                             ║
║     - Run same configuration twice with temperature 0             ║
║     - Expected: Identical results (or explainable differences)    ║
║     - Implementation: Run eval/run.js twice with same label       ║
║                                                                    ║
╚═══════════════════════════════════════════════════════════════════╝

To run controls:

1. NEGATIVE CONTROL:
   - Modify searchChunks in ingestion.js to shuffle results
   - Run: node eval/run.js --label negative-control
   - Verify Hit@3 ≈ 0

2. POSITIVE CONTROL:
   - Modify processChatQuestion to inject anchor chunks
   - Run: node eval/run.js --label positive-control
   - Verify Hit@3 = 1.0

3. REPEATABILITY:
   - Run: node eval/run.js --label repeat-1
   - Run: node eval/run.js --label repeat-2
   - Compare: node eval/compare.js eval/results/*repeat-1.json eval/results/*repeat-2.json
   - Verify identical metrics

Run all three before trusting any experimental results.
`);

console.log('\nControl implementations need to be added to the pipeline.');
console.log('See evalPipeline.js for where to inject control logic.');
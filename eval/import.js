#!/usr/bin/env node
/**
 * eval/import.js
 * Converts approved CSV (with keep=Y) to questions.jsonl
 * 
 * Usage: node eval/import.js --input eval/drafts.csv --output eval/questions.jsonl
 */

import { program } from 'commander';
import fs from 'fs';
import path from 'path';

program
  .requiredOption('-i, --input <file>', 'Input CSV file (from scaffold)')
  .option('-o, --output <file>', 'Output JSONL file', 'eval/questions.jsonl')
  .parse();

const opts = program.opts();
const inputFile = opts.input;
const outputFile = opts.output;

function parseCSV(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV with quoted fields
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
    
    if (fields.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = fields[idx].replace(/^"|"$/g, '').trim();
      });
      rows.push(row);
    }
  }
  
  return rows;
}

function main() {
  console.log(`[Import] Reading ${inputFile}...`);
  
  if (!fs.existsSync(inputFile)) {
    console.error(`File not found: ${inputFile}`);
    process.exit(1);
  }
  
  const csv = fs.readFileSync(inputFile, 'utf-8');
  const rows = parseCSV(csv);
  
  console.log(`[Import] Parsed ${rows.length} rows`);
  
  const approved = rows.filter(r => r.keep?.toUpperCase() === 'Y');
  console.log(`[Import] ${approved.length} rows marked keep=Y`);
  
  const jsonl = approved.map(row => {
    // Parse JSON fields
    let turns, expected, mustMention, mustNotMention;
    try { turns = JSON.parse(row.turns); } catch { turns = [row.turns]; }
    try { expected = JSON.parse(row.expected); } catch { expected = null; }
    try { mustMention = JSON.parse(row.mustMention); } catch { mustMention = []; }
    try { mustNotMention = JSON.parse(row.mustNotMention); } catch { mustNotMention = []; }
    
    return {
      id: row.id,
      subjectId: row.subjectId,
      type: row.type,
      turns,
      answerable: row.answerable === 'true',
      expected,
      mustMention,
      mustNotMention,
      source: row.source || 'synthetic',
      notes: row.notes || '',
    };
  });
  
  const jsonlContent = jsonl.map(JSON.stringify).join('\n');
  fs.writeFileSync(outputFile, jsonlContent);
  console.log(`[Import] Wrote ${jsonl.length} questions to ${outputFile}`);
}

main();
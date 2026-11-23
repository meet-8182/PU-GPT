/**
 * Guest (pu_info) evaluation runner and number-grounding checker.
 *
 * Usage:
 *   node eval/guest-check.mjs --api http://localhost:3001
 *   node eval/guest-check.mjs --results eval/results/pu-info-<timestamp>.json
 *
 * With --api it calls POST /api/public/ask for every question in
 * eval/pu-info.jsonl, records the answer and citations, then flags any number,
 * date or currency amount in an answer that does not appear in the retrieved
 * chunks. With --results it checks a previously saved result file.
 *
 * The question set is a scaffold: the two documents in eval/pu-info-docs are
 * clearly marked test data. Replace them with 30-50 real approved questions
 * before launch.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findUngroundedNumbers } from '../backend/src/services/guestChat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const questionsFile = path.join(__dirname, 'pu-info.jsonl');
const resultsDir = path.join(__dirname, 'results');

function parseArgs(argv) {
  const args = { api: null, results: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--api') args.api = argv[++i];
    else if (argv[i] === '--results') args.results = argv[++i];
  }
  return args;
}

function loadQuestions() {
  return fs.readFileSync(questionsFile, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function askGuest(apiBase, question) {
  const response = await fetch(`${apiBase.replace(/\/$/, '')}/api/public/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: question, history: [] }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { answer: `HTTP ${response.status}: ${text}`, citations: [], error: true };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let citations = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'content' && event.content) answer += event.content;
        if (event.type === 'citations') citations = event.citations || [];
      } catch {
        // ignore malformed frames
      }
    }
  }

  return { answer, citations };
}

function checkResults(questions, results) {
  const byId = new Map(results.map((result) => [result.id, result]));
  let failures = 0;

  for (const question of questions) {
    const result = byId.get(question.id);
    if (!result) {
      console.log(`[MISS] ${question.id} - no result recorded`);
      failures++;
      continue;
    }

    const chunks = (result.citations || []).map((citation) => ({
      text: citation.excerpt || '',
      metadata: { title: citation.sourceDoc || '' },
    }));
    const ungrounded = findUngroundedNumbers(result.answer || '', chunks);
    const missing = (question.must_include || []).filter((needle) => (
      !String(result.answer || '').toLowerCase().includes(String(needle).toLowerCase())
    ));

    const ok = ungrounded.length === 0 && missing.length === 0;
    if (!ok) failures++;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${question.id} (${question.type})`);
    if (ungrounded.length > 0) console.log(`        ungrounded numbers: ${ungrounded.join(', ')}`);
    if (missing.length > 0) console.log(`        missing expected text: ${missing.join(', ')}`);
    if (result.error) console.log(`        request error: ${result.answer}`);
  }

  return { failures, total: questions.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const questions = loadQuestions();

  if (args.results) {
    const results = JSON.parse(fs.readFileSync(args.results, 'utf-8'));
    const { failures, total } = checkResults(questions, results);
    console.log(`\n${total - failures}/${total} passed.`);
    process.exit(failures === 0 ? 0 : 1);
  }

  if (!args.api) {
    console.error('Pass --api <base-url> or --results <file>.');
    process.exit(2);
  }

  fs.mkdirSync(resultsDir, { recursive: true });
  const results = [];
  for (const question of questions) {
    console.log(`[ASK] ${question.id}: ${question.question}`);
    const result = await askGuest(args.api, question.question);
    results.push({ ...question, ...result });
  }

  const outputFile = path.join(resultsDir, `pu-info-${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  console.log(`\nSaved results to ${outputFile}`);

  const { failures, total } = checkResults(questions, results);
  console.log(`\n${total - failures}/${total} passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Guest evaluation failed:', error);
  process.exit(1);
});

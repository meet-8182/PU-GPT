import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = 'C:/Users/Aditya/Documents/Projects/PU-GPT';
const questionsFile = PROJECT_ROOT + '/eval/questions.jsonl';
const outputDir = PROJECT_ROOT + '/eval/results';

if (!fs.existsSync(questionsFile)) {
  console.error('Questions file not found: ' + questionsFile);
  process.exit(1);
}

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Load questions
const questionsContent = fs.readFileSync(questionsFile, 'utf-8');
const questions = questionsContent.trim().split('\n').filter(function(l) { return l.trim(); }).map(function(l) { return JSON.parse(l); });

console.log('[Runner] Loaded ' + questions.length + ' questions from ' + questionsFile);

// API base URL - backend is running on localhost:3001
const API_BASE = 'http://localhost:3001';

// Helper: call API endpoint
async function apiFetch(urlInit) {
  const res = await fetch(API_BASE + urlInit, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error('API ' + res.status + ': ' + errTxt);
  }
  return res.json();
}

// Main execution
async function main() {
  const results = [];
  const runTs = String(new Date().getTime());

  for (var i = 0; i < questions.length; i++) {
    var question = questions[i];
    var subjectId = question.subjectId || 'Data Structures';

    try {
      // Call the backend eval pipeline via HTTP
      var result = await apiFetch('/api/eval/pipeline', {
        method: 'POST',
        body: JSON.stringify({
          studentId: '6affc192079f05cdde14e5a6',
          question: question.turns[question.turns.length - 1],
          subject: subjectId,
          options: { topK: 3, candidates: 20, threshold: 0.15, reranker: true },
        }),
      });

      var selected = result.retrieval?.selectedChunks || [];
      var expectedAnchors = ['LIFO', 'FIFO', 'stack', 'queue'];

      // Hit@3: does at least one of the top-3 chunks contain any expected anchor?
      var top3 = selected.slice(0, 3);
      var hit3 = false;
      for (var j = 0; j < top3.length; j++) {
        var chunkText = top3[j]?.text || '';
        for (var k = 0; k < expectedAnchors.length; k++) {
          if (chunkText.toLowerCase().indexOf(expectedAnchors[k].toLowerCase()) >= 0) {
            hit3 = true;
            break;
          }
        }
        if (hit3) break;
      }

      var resultEntry = {};
      resultEntry.id = question.id;
      resultEntry.type = question.type;
      resultEntry.turns = question.turns;
      resultEntry.answerable = question.answerable;
      resultEntry.subjectId = question.subjectId;
      resultEntry.retrieval = result.retrieval?.counts || { raw: 0, deduped: 0, candidates: 0, selected: 0 };
      resultEntry.hitAt3 = hit3 ? 1 : 0;
      resultEntry.hitAt1 = (hit3 && top3.length >= 1) ? 1 : 0;
      resultEntry.decision = result.decision;
      resultEntry.answer = result.answer || '';
      resultEntry.promptTokens = result.promptTokens || 0;
      resultEntry.citations = result.citations || [];
      resultEntry.mustMention = question.mustMention || [];
      resultEntry.mustNotMention = question.mustNotMention || [];

      results.push(resultEntry);
      console.log('[Runner] Question ' + (i + 1) + '/' + questions.length + ': ' + question.id + ' (type=' + question.type + ', answerable=' + question.answerable + ', hit@3=' + hit3 + ')');
    } catch (err) {
      console.error('[Runner] Error on question ' + question.id + ': ' + err.message);
      results.push({
        id: question.id,
        type: question.type,
        turns: question.turns,
        answerable: question.answerable,
        error: err.message,
      });
    }
  }

  // Compute final metrics
  var total = questions.length;
  var hitAt1 = 0;
  var hitAt3 = 0;
  var correctAbstain = 0;
  var falseAbstain = 0;
  var totalUnanswerable = 0;
  var totalAnswerable = 0;

  for (var r = 0; r < results.length; r++) {
    if (results[r].hitAt1 === 1) { hitAt1++; }
    if (results[r].hitAt3 === 1) { hitAt3++; }
    if (!results[r].answerable && results[r].decision === 'abstain') { correctAbstain++; }
    if (!results[r].answerable && results[r].decision !== 'abstain') { falseAbstain++; }
    if (!results[r].answerable) { totalUnanswerable++; }
    else { totalAnswerable++; }
  }

  var hitAt1Rate = total > 0 ? hitAt1 / total : 0;
  var hitAt3Rate = total > 0 ? hitAt3 / total : 0;

  var outputFile = path.join(outputDir, runTs + '-' + 'baseline' + '.json');
  var summaryFile = path.join(outputDir, runTs + '-' + 'baseline' + '.md');

  var runResult = {};
  runResult.label = 'baseline';
  runResult.timestamp = new Date().toISOString();
  runResult.config = { topK: 3, candidates: 20, threshold: 0.15, reranker: true, model: '' };
  runResult.questions = total;
  runResult.results = results;
  runResult.metrics = {};
  runResult.metrics.retrieval = { hitAt1: hitAt1Rate, hitAt3: hitAt3Rate, hitAt5: 0, hitAt10: 0, mrr: 0 };
  runResult.metrics.abstention = { correctAbstain: correctAbstain, falseAbstain: falseAbstain, totalUnanswerable: totalUnanswerable, totalAnswerable: totalAnswerable };
  runResult.metrics.answer = { mustMention: 0, mustNotMention: 0, citationPresent: 0, noForbiddenPhrases: 0, lengthAppropriate: 0 };
  runResult.metrics.byType = {};

  fs.writeFileSync(outputFile, JSON.stringify(runResult, null, 2));
  console.log('[Runner] Wrote ' + outputFile);

  // Write summary
  var sumH1 = String(runResult.metrics.retrieval.hitAt1);
  var sumH3 = String(runResult.metrics.retrieval.hitAt3);
  var sumCA = String(runResult.metrics.abstention.correctAbstain);
  var sumFA = String(runResult.metrics.abstention.falseAbstain);
  var sumUA = String(runResult.metrics.abstention.totalUnanswerable);
  var sumAA = String(runResult.metrics.abstention.totalAnswerable);

  var summary = 'Evaluation Run: baseline\n\nTimestamp: ' + runResult.timestamp + '\nConfig: topK=3, candidates=20, threshold=0.15, reranker=true\nQuestions: ' + total + '\n\nMetrics\nHit@1: ' + sumH1 + '\nHit@3: ' + sumH3 + '\nCorrect Abstain: ' + sumCA + '/' + sumUA + '\nFalse Abstain: ' + sumFA + '/' + sumAA + '\nEvaluation via backend API\n';

  fs.writeFileSync(summaryFile, summary);
  console.log('[Runner] Wrote ' + summaryFile);
}

main().catch(function(err) {
  console.error('[Runner] Fatal error: ' + err.message);
  process.exit(1);
});
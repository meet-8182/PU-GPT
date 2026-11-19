/**
 * eval/metrics.js
 * Metric computation for evaluation results.
 */

import { normalizeText } from '../backend/src/services/followUp.js';

/**
 * Check if a chunk contains any anchor phrase.
 * @param {string} chunkText - The chunk text
 * @param {string[]} anchors - Array of anchor phrases
 * @returns {boolean}
 */
export function chunkHitsAnchor(chunkText, anchors) {
  const normalizedChunk = normalizeText(chunkText);
  for (const anchor of anchors) {
    const normalizedAnchor = normalizeText(anchor);
    if (normalizedChunk.includes(normalizedAnchor)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute Hit@k for a single question.
 * @param {Object} result - Pipeline result for one question
 * @param {number} k - k value
 * @returns {boolean}
 */
export function hitAtK(result, k) {
  if (!result.questionData?.expected?.anchors) return false;
  const selectedChunks = result.retrieval?.selectedChunks || [];
  const anchors = result.questionData.expected.anchors;
  const topK = selectedChunks.slice(0, k);
  return topK.some(chunk => chunkHitsAnchor(chunk.text, anchors));
}

/**
 * Compute MRR (Mean Reciprocal Rank) for a single question.
 * @param {Object} result - Pipeline result
 * @returns {number}
 */
export function mrrForQuestion(result) {
  if (!result.questionData?.expected?.anchors) return 0;
  const selectedChunks = result.retrieval?.selectedChunks || [];
  const anchors = result.questionData.expected.anchors;
  for (let i = 0; i < selectedChunks.length; i++) {
    if (chunkHitsAnchor(selectedChunks[i].text, anchors)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Compute duplicate rate - share of questions with duplicate chunks in final selection.
 * @param {Object} result - Pipeline result
 * @returns {boolean}
 */
export function hasDuplicateChunks(result) {
  const selectedChunks = result.retrieval?.selectedChunks || [];
  const seen = new Set();
  for (const chunk of selectedChunks) {
    const fingerprint = normalizeText(chunk.text).slice(0, 300);
    if (seen.has(fingerprint)) return true;
    seen.add(fingerprint);
  }
  return false;
}

/**
 * Compute off-topic rate - share of final chunks with no topic words.
 * @param {Object} result - Pipeline result
 * @returns {boolean}
 */
export function hasOffTopicChunks(result) {
  const selectedChunks = result.retrieval?.selectedChunks || [];
  const topicWords = result.analysis?.topicKeywords || [];
  if (topicWords.length === 0) return false;
  for (const chunk of selectedChunks) {
    const normalizedChunk = normalizeText(chunk.text);
    let hasTopicWord = false;
    for (const word of topicWords) {
      if (normalizedChunk.includes(normalizeText(word))) {
        hasTopicWord = true;
        break;
      }
    }
    if (!hasTopicWord) return true;
  }
  return false;
}

/**
 * Check answer quality metrics.
 * @param {Object} result - Pipeline result
 * @returns {Object}
 */
export function checkAnswer(result) {
  const answer = result.answer || '';
  const expected = result.questionData?.expected || {};
  const mustMention = result.questionData?.mustMention || [];
  const mustNotMention = result.questionData?.mustNotMention || [];
  const citations = result.citations || [];
  const selectedChunks = result.retrieval?.selectedChunks || [];
  
  // Must mention
  const missingMustMention = mustMention.filter(w => !answer.toLowerCase().includes(w.toLowerCase()));
  const mustMentionOk = missingMustMention.length === 0;
  
  // Must not mention
  const foundMustNotMention = mustNotMention.filter(w => answer.toLowerCase().includes(w.toLowerCase()));
  const mustNotMentionOk = foundMustNotMention.length === 0;
  
  // Citation present and points to retrieved chunk
  let citationOk = false;
  if (citations.length > 0) {
    for (const citation of citations) {
      const found = selectedChunks.some(c => c.id === citation.chunkId);
      if (found) { citationOk = true; break; }
    }
  }
  
  // Forbidden phrases
  const forbiddenPhrases = ['in this example', 'as shown above', 'the retrieved context', 'the material states', 'this code snippet'];
  const hasForbidden = forbiddenPhrases.some(p => answer.toLowerCase().includes(p));
  
  // Length appropriate (rough heuristic based on cue)
  const cue = result.analysis?.cue || 'general';
  const wordCount = answer.split(/\s+/).filter(Boolean).length;
  let lengthOk = true;
  if (cue === 'short' && wordCount > 80) lengthOk = false;
  if (cue === 'detail' && wordCount < 50) lengthOk = false;
  
  return {
    mustMention: mustMentionOk,
    mustNotMention: mustNotMentionOk,
    citationPresent: citationOk,
    noForbiddenPhrases: !hasForbidden,
    lengthAppropriate: lengthOk,
  };
}

/**
 * Aggregate metrics across all results.
 * @param {Object[]} results - Array of pipeline results
 * @returns {Object}
 */
export function aggregateMetrics(results) {
  const answerable = results.filter(r => r.questionData?.answerable !== false);
  const unanswerable = results.filter(r => r.questionData?.answerable === false);
  
  // Retrieval metrics
  const hitAt1 = answerable.filter(r => hitAtK(r, 1)).length / answerable.length || 0;
  const hitAt3 = answerable.filter(r => hitAtK(r, 3)).length / answerable.length || 0;
  const hitAt5 = answerable.filter(r => hitAtK(r, 5)).length / answerable.length || 0;
  const hitAt10 = answerable.filter(r => hitAtK(r, 10)).length / answerable.length || 0;
  const mrr = answerable.reduce((sum, r) => sum + mrrForQuestion(r), 0) / answerable.length || 0;
  
  // Duplicate and off-topic
  const duplicateRate = answerable.filter(r => hasDuplicateChunks(r)).length / answerable.length || 0;
  const offTopicRate = answerable.filter(r => hasOffTopicChunks(r)).length / answerable.length || 0;
  
  // Abstention
  const correctAbstain = unanswerable.filter(r => r.decision === 'abstain').length;
  const correctAbstainRate = unanswerable.length > 0 ? correctAbstain / unanswerable.length : 0;
  const falseAbstain = answerable.filter(r => r.decision === 'abstain').length;
  const falseAbstainRate = answerable.length > 0 ? falseAbstain / answerable.length : 0;
  
  // Answer checks
  const answerableWithAnswers = answerable.filter(r => r.answer);
  let mustMention = 0, mustNotMention = 0, citationPresent = 0, noForbiddenPhrases = 0, lengthAppropriate = 0;
  
  for (const r of answerableWithAnswers) {
    const checks = checkAnswer(r);
    if (checks.mustMention) mustMention++;
    if (checks.mustNotMention) mustNotMention++;
    if (checks.citationPresent) citationPresent++;
    if (checks.noForbiddenPhrases) noForbiddenPhrases++;
    if (checks.lengthAppropriate) lengthAppropriate++;
  }
  
  const n = answerableWithAnswers.length || 1;
  
  // By type
  const byType = {};
  for (const r of results) {
    const type = r.questionData?.type || 'unknown';
    if (!byType[type]) {
      byType[type] = { total: 0, hitAt3: 0, correctAbstain: 0, falseAbstain: 0 };
    }
    byType[type].total++;
    if (r.questionData?.answerable !== false) {
      if (hitAtK(r, 3)) byType[type].hitAt3++;
      if (r.decision === 'abstain') byType[type].falseAbstain++;
    } else {
      if (r.decision === 'abstain') byType[type].correctAbstain++;
    }
  }
  
  return {
    retrieval: {
      hitAt1: hitAt1,
      hitAt3: hitAt3,
      hitAt5: hitAt5,
      hitAt10: hitAt10,
      mrr: mrr,
      duplicateRate: duplicateRate,
      offTopicRate: offTopicRate,
    },
    abstention: {
      correctAbstain: correctAbstain,
      correctAbstainRate: correctAbstainRate,
      falseAbstain: falseAbstain,
      falseAbstainRate: falseAbstainRate,
      totalUnanswerable: unanswerable.length,
      totalAnswerable: answerable.length,
    },
    answer: {
      mustMention: mustMention / n,
      mustNotMention: mustNotMention / n,
      citationPresent: citationPresent / n,
      noForbiddenPhrases: noForbiddenPhrases / n,
      lengthAppropriate: lengthAppropriate / n,
    },
    byType,
  };
}

/**
 * Find worst failures for reporting.
 * @param {Object[]} results - Pipeline results
 * @returns {Object[]}
 */
export function getWorstFailures(results, limit = 10) {
  const answerable = results.filter(r => r.questionData?.answerable !== false && r.answer);
  const scored = answerable.map(r => {
    const checks = checkAnswer(r);
    const hit3 = hitAtK(r, 3);
    const score = (checks.mustMention ? 1 : 0) + (checks.citationPresent ? 1 : 0) + (hit3 ? 1 : 0);
    return { result: r, score, checks, hit3 };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map(s => ({
    question: s.result.questionData.turns[s.result.questionData.turns.length - 1],
    expectedAnchor: s.result.questionData.expected?.anchors?.[0] || '',
    retrievedChunks: s.result.retrieval?.selectedChunks?.map(c => c.text.slice(0, 120)) || [],
    answer: s.result.answer?.slice(0, 200) || '',
    hitAt3: s.hit3,
    checks: s.checks,
  }));
}

export default {
  chunkHitsAnchor,
  hitAtK,
  mrrForQuestion,
  hasDuplicateChunks,
  hasOffTopicChunks,
  checkAnswer,
  aggregateMetrics,
  getWorstFailures,
};
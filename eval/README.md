# PU-GPT Evaluation Harness

This directory contains the evaluation harness for PU-GPT. It runs a fixed set of questions through the real chat pipeline and reports objective metrics so every change (chunk size, top-k, score cutoff, reranker, model) can be compared.

## Quick Start

```bash
# 1. Install dependencies (from project root)
npm install commander

# 2. Create draft questions (scaffold)
node eval/scaffold.js --subject "Data Structures" --count 60

# 3. Review drafts in eval/drafts.csv, mark keep=Y for approved rows

# 4. Import approved drafts
node eval/import.js --input eval/drafts.csv --output eval/questions.jsonl

# 5. Run evaluation (requires backend running)
node eval/run.js --label baseline

# 6. View results
cat eval/results/<timestamp>-baseline.md
```

## Directory Structure

```
eval/
├── questions.jsonl      # Gold standard questions (JSONL)
├── drafts.csv           # Scaffold output for human review
├── templates.csv        # Hand-written question templates
├── scaffold.js          # Generate draft questions from vector store
├── import.js            # Convert approved CSV → JSONL
├── run.js               # Run evaluation suite
├── metrics.js           # Metric computations
├── export-grading.js    # Export answers for human grading
├── import-grading.js    # Import human grades
├── compare.js           # Compare two runs
├── check.js             # CI gate (exit code on regression)
├── controls.js          # Three validation controls
├── runPipeline.js       # (in backend/src/services/) Exposed pipeline
└── results/             # Output directory (gitignored)
```

## Question Format (questions.jsonl)

One JSON object per line:

```json
{
  "id": "ds-001",
  "subjectId": "Data Structures",
  "type": "definition | concept | followup | code | typo | multipart | unanswerable",
  "turns": ["What is a stack?", "explain in detail"],
  "answerable": true,
  "expected": {
    "anchors": ["last in first out", "elements are added and removed from the top"],
    "doc": "Unit-1.pdf",
    "pages": [3]
  },
  "mustMention": ["LIFO", "push", "pop"],
  "mustNotMention": [],
  "source": "human | synthetic",
  "notes": ""
}
```

- **Ground truth = anchors**, not chunk IDs. An anchor is a 5-12 word phrase copied from source.
- A retrieved chunk hits if it contains any anchor (after lowercasing/whitespace normalization).
- For `unanswerable`: `answerable: false`, `expected: null`. Correct behavior = offer web search.

## Target Mix (≈100 questions)

| Type | Count |
|------|-------|
| Definition / Concept | 40 |
| Follow-up pairs | 15 |
| Code requests | 10 |
| Typo / Hinglish / very short | 10 |
| Unanswerable | 15 |
| Multi-part / Comparison | 10 |

## Building the Question Set

### 1. Scaffold (synthetic drafts)

```bash
node eval/scaffold.js --subject "Data Structures" --count 60
```

- Samples chunks from vector store across the subject
- Uses local model to draft one question + anchor per chunk
- Outputs `eval/drafts.csv` with columns: id, type, turns, anchors, doc, page, mustMention, keep, notes

### 2. Human Review

Open `eval/drafts.csv`, mark `keep=Y` for approved rows, fix wording.

### 3. Import

```bash
node eval/import.js --input eval/drafts.csv --output eval/questions.jsonl
```

- Only rows with `keep=Y` are imported
- Adds `source: "synthetic"`

### 4. Add Hand-Written Questions

Use `eval/templates.csv` as reference for follow-up, typo, Hinglish, code, unanswerable, multi-part types. Add directly to `questions.jsonl`.

## Running Evaluation

### Prerequisites

- Backend running: `cd backend && node src/index.js`
- Valid eval student in DB (or use existing student ID)

### Run

```bash
node eval/run.js --label baseline [--topK 3] [--candidates 20] [--threshold 0.15] [--reranker on] [--model name]
```

Options:
- `--label` - Run identifier (required)
- `--topK` - Chunks sent to model (default: 3)
- `--candidates` - Initial retrieval pool (default: 20)
- `--threshold` - Score cutoff for abstain (default: 0.15)
- `--reranker` - Topic reranker on/off (default: on)
- `--model` - Model override (optional)

Outputs:
- `eval/results/<timestamp>-<label>.json` - Full results
- `eval/results/<timestamp>-<label>.md` - Summary

## Metrics Reported

### Retrieval (answerable only)
- **Hit@k** for k=1,3,5,10 (main: Hit@3)
- **MRR** - Mean Reciprocal Rank
- **Duplicate rate** - % questions with identical final chunks
- **Off-topic rate** - % final chunks with no topic words

### Abstention
- **Correct abstain rate** on unanswerable (offer web search)
- **False abstain rate** on answerable

### Answer Quality (automatic)
- Must-mention coverage
- No must-not-mention
- Citation present & points to retrieved chunk
- No forbidden phrases ("in this example", "as shown above")
- Length appropriate for cue

### Human Grading (sample of 30)
```bash
node eval/export-grading.js --results eval/results/<file>.json
# Grade the CSV: correct (0/1/2), grounded (0/1), clear (0/1)
node eval/import-grading.js --results eval/results/<file>.json --grading eval/grading.csv
```

## Comparison & CI

### Compare Two Runs
```bash
node eval/compare.js eval/results/a.json eval/results/b.json
```

Shows metric deltas and flipped questions.

### CI Gate
```bash
node eval/check.js --current eval/results/latest.json --baseline eval/baseline.json --threshold 3
```
Exits with error code if Hit@3 or correct-abstain drops >3 points.

## Controls (Validate Harness)

Run these **before trusting any experiment**:

```bash
# 1. Negative control - random retrieval
node eval/controls.js  # See instructions
# Expected: Hit@3 ≈ 0%

# 2. Positive control - inject anchor chunk
# Expected: Hit@3 = 100%

# 3. Repeatability
node eval/run.js --label repeat-1
node eval/run.js --label repeat-2
node eval/compare.js eval/results/*repeat-1.json eval/results/*repeat-2.json
# Expected: Identical results
```

## First Experiments to Run

| Experiment | Command | Report |
|------------|---------|--------|
| (a) Baseline | `node eval/run.js --label baseline` | Table |
| (b) Dedup on | `node eval/run.js --label dedup-on` | Δ vs (a) |
| (c) Top-k 3/5/8 | `node eval/run.js --label topk-5 --topK 5` etc. | Table |
| (d) Chunk sizes | Modify `SUBJECT_CHUNK_CONFIG` in ingestion.js | Table |
| (e) Score cutoffs | `node eval/run.js --label thresh-02 --threshold 0.2` | Table |

## Pipeline Integration

The harness calls the **same** `runPipeline` function that the chat route uses:

```javascript
// backend/src/services/evalPipeline.js
export async function runPipeline({ studentId, question, subject, options }) {
  // Returns: rewritten question, retrieval query, chunks before/after dedup/rank,
  // decision, answer, citations, timings, etc.
}
```

The chat route (`processChatQuestion`) calls this same function. Measured behavior = real behavior.

## Configuration

Pipeline options passed via environment/config, never by editing code between runs:

```bash
# .env or config
EVAL_TOP_K=3
EVAL_CANDIDATES=20
EVAL_THRESHOLD=0.15
EVAL_RERANKER=on
EVAL_MODEL=qwen2.5:3b-instruct-q4_K_M
```

## Files to Hand Back

When running experiments, provide:
1. Summary markdown from `eval/results/<timestamp>-<label>.md`
2. Results of three controls
3. This command list (README)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Student not found" | Create eval student in DB or use existing ID |
| "Model not found" | Ensure Ollama has the model: `ollama pull qwen2.5:3b-instruct-q4_K_M` |
| "Vector store empty" | Index documents first via teacher upload |
| Import fails | Check CSV quoting, ensure `keep=Y` rows only |
| Metrics all zero | Verify questions have `expected.anchors` and `answerable: true` |

## Adding New Subjects

1. Add subject to `questions.jsonl` with correct `subjectId`
2. Ensure documents indexed for that subject
3. Run scaffold/import for that subject
4. Run evaluation with `--label <subject>-baseline`
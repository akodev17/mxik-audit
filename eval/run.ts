// Gate 1 evaluation harness. Built before the algorithm was tuned, so the
// numbers are a check on the pipeline rather than a description of it.
// Run: npm run eval
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { z } from 'zod';
import { embeddingProviderFromEnv } from '../src/core/embed/index.js';
import { matchProduct } from '../src/core/match/pipeline.js';
import { rerankProviderFromEnv } from '../src/core/match/rerank.js';
import { PostgresCandidateStore } from '../src/core/match/store.js';
import { checkVectorReadiness } from '../src/core/match/vector-readiness.js';
import { BANDS } from '../src/core/match/score.js';

const CaseSchema = z.object({
  id: z.string(),
  source: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  rawName: z.string().min(1),
  barcode: z.string().nullish(),
  unit: z.string().nullish(),
  existingMxik: z.string().nullish(),
  expected: z.string().regex(/^\d{17}$/),
  acceptable: z.array(z.string().regex(/^\d{17}$/)).default([]),
  why: z.string(),
});

const GoldenSchema = z.object({
  note: z.string(),
  catalogSnapshot: z.string(),
  cases: z.array(CaseSchema).min(1),
});

const golden = GoldenSchema.parse(JSON.parse(readFileSync('eval/golden.json', 'utf8')));

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const configured = embeddingProviderFromEnv();
const reranker = rerankProviderFromEnv();

// Never compare a query embedded by one model against vectors stored by another.
const readiness = await checkVectorReadiness(pool, configured);
const embedder = readiness.embedder;
const store = new PostgresCandidateStore(pool, {
  // The placeholder embedder's sparse vectors defeat HNSW; see store.ts.
  exactVectorScan: !embedder.semantic,
  vectorEnabled: readiness.usable,
});

console.log('='.repeat(78));
console.log('MXIK matching evaluation');
console.log('='.repeat(78));
console.log(`cases           ${golden.cases.length} (${golden.cases.filter((c) => c.source === 'seeded').length} seeded)`);
console.log(`catalog         ${golden.catalogSnapshot}`);
console.log(`embeddings      ${embedder.name}${embedder.semantic ? '' : '   <-- NOT SEMANTIC'}`);
if (readiness.stored) console.log(`  stored vectors  ${readiness.stored.provider} (${readiness.stored.rowsEmbedded.toLocaleString()} rows)`);
if (readiness.reason) console.log(`  vector stage    ${readiness.usable ? 'SUBSTITUTED' : 'DISABLED'}: ${readiness.reason}`);
console.log(`reranker        ${reranker.name}${reranker.available ? '' : '   <-- DISABLED'}`);
if (!embedder.semantic || !reranker.available || !readiness.usable) {
  console.log('');
  console.log('  WARNING: the pipeline is running degraded. Stage 4 (vector) and/or');
  console.log('  stage 6 (LLM rerank) are not using real providers, so these numbers are');
  console.log('  a floor, not the achievable accuracy. See docs/scoring.md.');
}
console.log('');

type Outcome = {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  rawName: string;
  expected: string;
  acceptable: string[];
  predicted: string | null;
  predictedName: string | null;
  confidence: number;
  band: string;
  rankOfCorrect: number | null;
  inPool: boolean;
  poolSize: number;
  rankInPool: number | null;
  top1: boolean;
  top5: boolean;
  decidedBy: string;
  reason: string;
  notes: string[];
  ms: number;
};

const outcomes: Outcome[] = [];

for (const testCase of golden.cases) {
  const accept = new Set([testCase.expected, ...testCase.acceptable]);
  const t0 = Date.now();
  const result = await matchProduct({
    rawName: testCase.rawName,
    barcode: testCase.barcode ?? null,
    unit: testCase.unit ?? null,
    existingMxik: testCase.existingMxik ?? null,
  }, { store, embedder, reranker });
  const ms = Date.now() - t0;

  const codes = result.candidates.map((c) => c.candidate.code);
  const rankIndex = codes.findIndex((c) => accept.has(c));
  const poolIndex = result.pool.findIndex((c) => accept.has(c));
  const top = result.candidates[0];

  outcomes.push({
    id: testCase.id,
    difficulty: testCase.difficulty,
    rawName: testCase.rawName,
    expected: testCase.expected,
    acceptable: testCase.acceptable,
    predicted: top?.candidate.code ?? null,
    predictedName: top?.candidate.nameUz ?? null,
    confidence: top?.confidence ?? 0,
    band: top?.band ?? 'none',
    rankOfCorrect: rankIndex === -1 ? null : rankIndex + 1,
    inPool: poolIndex !== -1,
    poolSize: result.pool.length,
    rankInPool: poolIndex === -1 ? null : poolIndex + 1,
    top1: rankIndex === 0,
    top5: rankIndex !== -1 && rankIndex < 5,
    decidedBy: result.decidedBy,
    reason: top?.reason ?? '(no candidate)',
    notes: result.notes,
    ms,
  });
}

// ------------------------------------------------------------------ aggregate
const n = outcomes.length;
const top1 = outcomes.filter((o) => o.top1).length;
const top5 = outcomes.filter((o) => o.top5).length;
const correct = outcomes.filter((o) => o.top1);
const incorrect = outcomes.filter((o) => !o.top1);
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const meanCorrect = mean(correct.map((o) => o.confidence));
const meanIncorrect = mean(incorrect.map((o) => o.confidence));

console.log('per-case breakdown');
console.log('-'.repeat(78));
console.log('res  rank  conf  band    decidedBy  case');
for (const o of outcomes) {
  const mark = o.top1 ? ' ok ' : o.top5 ? 'top5' : 'MISS';
  const rank = o.rankOfCorrect === null ? '  - ' : String(o.rankOfCorrect).padStart(4);
  console.log(`${mark} ${rank}  ${o.confidence.toFixed(2)}  ${o.band.padEnd(6)}  ${o.decidedBy.padEnd(9)}  ${o.id}`);
  if (!o.top1) {
    console.log(`            want ${o.expected}${o.acceptable.length ? ` (or ${o.acceptable.join(', ')})` : ''}`);
    console.log(`            got  ${o.predicted ?? '(none)'}  ${(o.predictedName ?? '').slice(0, 52)}`);
  }
}

console.log('');
console.log('='.repeat(78));
console.log('RESULTS');
console.log('='.repeat(78));
console.log(`top-1 accuracy               ${top1}/${n}  ${((top1 / n) * 100).toFixed(1)}%`);
console.log(`top-5 accuracy               ${top5}/${n}  ${((top5 / n) * 100).toFixed(1)}%`);
console.log(`mean confidence when right   ${meanCorrect.toFixed(3)}  (n=${correct.length})`);
console.log(`mean confidence when wrong   ${meanIncorrect.toFixed(3)}  (n=${incorrect.length})`);
console.log(`separation (right - wrong)   ${(meanCorrect - meanIncorrect).toFixed(3)}${meanCorrect > meanIncorrect ? '' : '   <-- INVERTED: confidence is anti-predictive'}`);
console.log(`median latency               ${[...outcomes].map((o) => o.ms).sort((a, b) => a - b)[Math.floor(n / 2)]}ms`);

const inPool = outcomes.filter((o) => o.inPool).length;
console.log('');
console.log(`RERANKER CEILING             ${inPool}/${n}  ${((inPool / n) * 100).toFixed(1)}%`);
console.log('  = share of cases where a correct code reached the pool handed to stage 6.');
console.log('  A perfect reranker could not beat this; a code absent from the pool is');
console.log('  unreachable. Gap to top-1 is what reranking has left to win.');
console.log(`  headroom: ${(((inPool - top1) / n) * 100).toFixed(1)} points`);
const missedPool = outcomes.filter((o) => !o.inPool);
if (missedPool.length > 0) {
  console.log('  never retrieved at all:');
  for (const o of missedPool) console.log(`    ${o.id} (pool of ${o.poolSize})`);
}

console.log('');
console.log('by difficulty');
for (const level of ['easy', 'medium', 'hard'] as const) {
  const group = outcomes.filter((o) => o.difficulty === level);
  if (group.length === 0) continue;
  console.log(`  ${level.padEnd(7)} top-1 ${group.filter((o) => o.top1).length}/${group.length}   top-5 ${group.filter((o) => o.top5).length}/${group.length}`);
}

console.log('');
console.log('band calibration (does the band mean what it claims?)');
for (const band of ['high', 'medium', 'low'] as const) {
  const group = outcomes.filter((o) => o.band === band);
  if (group.length === 0) { console.log(`  ${band.padEnd(6)} (none)`); continue; }
  const precision = group.filter((o) => o.top1).length / group.length;
  console.log(`  ${band.padEnd(6)} n=${String(group.length).padStart(2)}  top-1 precision ${(precision * 100).toFixed(0)}%`);
}
console.log(`  thresholds: high >= ${BANDS.high}, medium >= ${BANDS.medium}, low below`);

console.log('');
console.log('decision rule');
const t5 = (top5 / n) * 100;
const t1 = (top1 / n) * 100;
if (t5 < 80) {
  console.log(`  top-5 is ${t5.toFixed(1)}%, below the 80% floor -> HALT. The tool cannot reduce manual work.`);
} else if (t1 > 95) {
  console.log(`  top-1 is ${t1.toFixed(1)}%, above 95% -> the golden set is too easy. Ask for harder cases.`);
} else if (t1 >= 60 && t1 <= 85 && t5 > 90) {
  console.log(`  top-1 ${t1.toFixed(1)}%, top-5 ${t5.toFixed(1)}% -> the intended shape. AI proposes, human confirms.`);
} else {
  console.log(`  top-1 ${t1.toFixed(1)}%, top-5 ${t5.toFixed(1)}% -> between the stated bands; needs a judgement call.`);
}

writeFileSync('docs/eval-results.json', JSON.stringify({
  ranAt: new Date().toISOString(),
  catalogSnapshot: golden.catalogSnapshot,
  providers: {
    embedding: embedder.name, embeddingSemantic: embedder.semantic,
    reranker: reranker.name, rerankerAvailable: reranker.available,
    embeddingConfigured: configured.name, vectorUsable: readiness.usable,
    vectorSubstituted: readiness.substituted, storedEmbeddingProvider: readiness.stored?.provider ?? null,
  },
  summary: {
    n, top1, top5,
    top1Pct: (top1 / n) * 100, top5Pct: (top5 / n) * 100,
    meanConfidenceCorrect: meanCorrect, meanConfidenceIncorrect: meanIncorrect,
    rerankerCeiling: inPool, rerankerCeilingPct: (inPool / n) * 100,
  },
  outcomes,
}, null, 2));
console.log('\nwrote docs/eval-results.json');

await pool.end();

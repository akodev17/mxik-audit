// Matching evaluation. Reads eval/golden.csv (real) and eval/synthetic.csv
// (derived from classifier names), runs the full pipeline plus one ablation per
// stage, reports real and synthetic separately, and appends the run to
// docs/eval-results.json without overwriting earlier runs.
// Run: npm run eval [-- --label "after key" --no-ablate]
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { embeddingProviderFromEnv } from '../src/core/embed/index.js';
import { matchProduct, type DisableableStage } from '../src/core/match/pipeline.js';
import { NoopRerankProvider, rerankFromEnv } from '../src/core/match/rerank.js';
import { MemoryRerankCache } from '../src/core/match/rerank-cache.js';
import { costPer1000Rows, formatLlmUsage } from '../src/core/match/rerank-usage.js';
import { PostgresCandidateStore } from '../src/core/match/store.js';
import { checkVectorReadiness } from '../src/core/match/vector-readiness.js';
import { BANDS } from '../src/core/match/score.js';
import type { RerankProvider, RerankVerdict } from '../src/core/match/types.js';
import { parseCases, type EvalCase } from './cases.js';
import { MemoStore } from './memo-store.js';
import { bySource, type GroupMetrics, type Outcome } from './metrics.js';

const FILES = ['eval/golden.csv', 'eval/synthetic.csv'];
const RESULTS = 'docs/eval-results.json';
const CONCURRENCY = 6;

const argValue = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LABEL = argValue('--label') ?? 'eval';
const ABLATE = !process.argv.includes('--no-ablate');

// ------------------------------------------------------------------ cases
const loaded: EvalCase[] = [];
for (const file of FILES) {
  if (!existsSync(file)) {
    console.log(`(skipping ${file}: not found — run \`npm run eval:synthetic\` for the synthetic set)`);
    continue;
  }
  const { cases, errors } = parseCases(readFileSync(file, 'utf8'), file.replace(/^eval\//, ''));
  for (const e of errors) console.log(`INVALID ROW ${e}`);
  loaded.push(...cases);
}

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const configured = embeddingProviderFromEnv();
const readiness = await checkVectorReadiness(pool, configured);
const embedder = readiness.embedder;
const baseStore = new PostgresCandidateStore(pool, {
  // The placeholder embedder's sparse vectors defeat HNSW; see store.ts.
  exactVectorScan: !embedder.semantic,
  vectorEnabled: readiness.usable,
});
const store = new MemoStore(baseStore);

// Never score against a label that is not a live classifier code.
const live = await baseStore.liveCodes([...new Set(loaded.flatMap((c) => c.correct))]);
const excluded: string[] = [];
const cases = loaded.flatMap((c) => {
  const correct = c.correct.filter((code) => live.has(code));
  if (correct.length === 0) {
    excluded.push(`${c.id} (${c.correct.join('|')} not in classifier)`);
    return [];
  }
  return [{ ...c, correct }];
});

const { reranker: realReranker, gate } = rerankFromEnv(process.env, new MemoryRerankCache());

/** Without a key, still measure what the gate would send, at zero cost and no effect on scores. */
class DryRunReranker implements RerankProvider {
  readonly name = 'dry run (gate only, no call)';
  readonly available = true;
  rerank(): Promise<RerankVerdict[]> { return Promise.resolve([]); }
}
const reranker: RerankProvider = realReranker.available ? realReranker : new DryRunReranker();

// --------------------------------------------------------------- header
const codeCount = (await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code WHERE "retiredAt" IS NULL')).rows[0]?.n ?? '?';
const commit = (() => {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain -- src eval', { encoding: 'utf8' }).trim() !== '';
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
})();

const real = cases.filter((c) => c.source === 'real');
const synthetic = cases.filter((c) => c.source === 'synthetic');

console.log('='.repeat(78));
console.log(`MXIK matching evaluation — ${LABEL}`);
console.log('='.repeat(78));
console.log(`code            ${commit}`);
console.log(`classifier      ${Number(codeCount).toLocaleString()} live codes`);
console.log(`cases           real ${real.length} · synthetic ${synthetic.length}${excluded.length ? ` · excluded ${excluded.length}` : ''}`);
for (const e of excluded) console.log(`  excluded: ${e}`);
console.log(`embeddings      ${embedder.name}${embedder.semantic ? '' : '   <-- NOT SEMANTIC'}`);
if (readiness.reason) console.log(`  vector stage    ${readiness.usable ? 'SUBSTITUTED' : 'DISABLED'}: ${readiness.reason}`);
console.log(`reranker        ${realReranker.name}${realReranker.available ? '' : '   <-- DISABLED (gate measured in dry run)'}`);
console.log(`rerank gate     top-1 < ${gate.minConfidence} or margin < ${gate.minMargin}`);
console.log('');
console.log('  NOTE: "real" here means hand-written cases, not customer files, until real');
console.log('  catalogue rows are added to eval/golden.csv.');
console.log('  WARNING: synthetic cases are derived from classifier names. They measure');
console.log('  robustness to noise and OVERESTIMATE accuracy on real catalogues.');
if (!embedder.semantic || !realReranker.available || !readiness.usable) {
  console.log('  WARNING: stage 4 and/or stage 6 are degraded; these numbers are a floor.');
}
console.log('');

// ------------------------------------------------------------------ run
type Config = { key: string; label: string; disabled: DisableableStage[]; reranker: RerankProvider };

async function runConfig(config: Config): Promise<Outcome[]> {
  const outcomes: Outcome[] = new Array<Outcome>(cases.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const index = next++;
      const testCase = cases[index];
      if (!testCase) return;
      let sent = false;
      const tracked: RerankProvider = {
        name: config.reranker.name,
        available: config.reranker.available,
        rerank: (request) => { sent = true; return config.reranker.rerank(request); },
      };
      const t0 = Date.now();
      const result = await matchProduct(
        { rawName: testCase.name, barcode: testCase.barcode, unit: testCase.unit },
        { store, embedder, reranker: tracked, rerankGate: gate, disabledStages: new Set(config.disabled) },
      );
      const accept = new Set(testCase.correct);
      const rankIndex = result.candidates.findIndex((c) => accept.has(c.candidate.code));
      const top = result.candidates[0];
      outcomes[index] = {
        id: testCase.id,
        source: testCase.source,
        name: testCase.name,
        correct: testCase.correct,
        predicted: top?.candidate.code ?? null,
        confidence: top?.confidence ?? 0,
        band: top?.band ?? 'none',
        rank: rankIndex === -1 ? null : rankIndex + 1,
        inPool: result.pool.some((c) => accept.has(c)),
        decidedBy: result.decidedBy,
        sentToLlm: sent,
        ms: Date.now() - t0,
      };
    }
  }));
  return outcomes;
}

const configs: Config[] = [
  { key: 'full', label: 'all stages', disabled: [], reranker },
  ...(ABLATE ? [
    { key: 'no-barcode', label: 'stage 1 off (barcode)', disabled: ['barcode'], reranker },
    { key: 'no-exact', label: 'stage 2 off (exact name)', disabled: ['exact'], reranker },
    { key: 'no-lexical', label: 'stage 3 off (trigram + full-text)', disabled: ['lexical'], reranker },
    { key: 'no-vector', label: 'stage 4 off (vector)', disabled: ['vector'], reranker },
    { key: 'no-rerank', label: 'stage 6 off (reranker)', disabled: [], reranker: new NoopRerankProvider('ablation') },
  ] satisfies Config[] : []),
];

const results: Record<string, ReturnType<typeof bySource>> = {};
let fullOutcomes: Outcome[] = [];
for (const config of configs) {
  const t0 = Date.now();
  const outcomes = await runConfig(config);
  results[config.key] = bySource(outcomes);
  if (config.key === 'full') fullOutcomes = outcomes;
  console.log(`ran ${config.label.padEnd(36)} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

// --------------------------------------------------------------- report
const f = (n: number | null, digits = 1): string => (n === null ? '   - ' : n.toFixed(digits).padStart(5));
function table(title: string, pick: (m: ReturnType<typeof bySource>) => GroupMetrics): void {
  console.log('');
  console.log(title);
  console.log('  config                               n   top1%  top5%  high-cov%  high-prec%  pool%  llm%');
  for (const config of configs) {
    const metrics = results[config.key];
    if (!metrics) continue;
    const m = pick(metrics);
    console.log(`  ${config.label.padEnd(34)} ${String(m.n).padStart(4)}  ${f(m.top1Pct)}  ${f(m.top5Pct)}  ${f(m.highCoveragePct).padStart(9)}  ${f(m.highPrecisionPct).padStart(10)}  ${f(m.ceilingPct)} ${f(m.llmSharePct)}`);
  }
}
table('REAL (hand-written) cases', (m) => m.real);
table('SYNTHETIC cases (derived from classifier names — optimistic)', (m) => m.synthetic);
console.log('');
console.log(`  high band = confidence >= ${BANDS.high}, the only band bulk accept may touch.`);
console.log('  pool% = correct code reached the rerank pool (the ceiling stage 6 can reach).');
console.log('  llm% = rows the gate sends to the reranker.');

console.log('');
console.log('real-case breakdown (all stages)');
for (const o of fullOutcomes.filter((x) => x.source === 'real')) {
  const mark = o.rank === 1 ? ' ok ' : o.rank !== null ? 'top5' : 'MISS';
  console.log(`  ${mark} ${o.confidence.toFixed(2)} ${o.band.padEnd(6)} ${o.decidedBy.padEnd(7)} ${o.name.slice(0, 48)}`);
  if (o.rank !== 1) console.log(`              want ${o.correct.join(' | ')}  got ${o.predicted ?? '(none)'}`);
}

const synthMisses = fullOutcomes.filter((o) => o.source === 'synthetic' && o.rank === null);
const noiseOf = (id: string): string[] => {
  const c = cases.find((x) => x.id === id);
  return /noise: ([^;]+)/.exec(c?.notes ?? '')?.[1]?.split(',').map((s) => s.trim()) ?? [];
};
const missByNoise = new Map<string, number>();
for (const o of synthMisses) for (const n of noiseOf(o.id)) missByNoise.set(n, (missByNoise.get(n) ?? 0) + 1);
console.log('');
console.log(`synthetic top-5 misses by noise type: ${[...missByNoise].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);

const usage = realReranker.usage?.() ?? null;
if (usage) {
  console.log('');
  console.log(formatLlmUsage(usage, cases.length));
}

// -------------------------------------------------------------- history
type History = { note: string; runs: unknown[] };
const NOTE = 'Append-only history of `npm run eval`. Each run records code version, classifier size, providers, per-config metrics split by real/synthetic, and per-case outcomes for the full pipeline.';
let history: History = { note: NOTE, runs: [] };
if (existsSync(RESULTS)) {
  const previous = JSON.parse(readFileSync(RESULTS, 'utf8')) as Partial<History> & Record<string, unknown>;
  history = Array.isArray(previous.runs)
    ? { note: NOTE, runs: previous.runs }
    // Older single-run format: keep it as the first history entry.
    : { note: NOTE, runs: [{ label: 'gate 1 (single-run format)', ...previous }] };
}

history.runs.push({
  label: LABEL,
  ranAt: new Date().toISOString(),
  code: commit,
  classifierLiveCodes: Number(codeCount),
  providers: {
    embedding: embedder.name, embeddingSemantic: embedder.semantic, vectorUsable: readiness.usable,
    reranker: realReranker.name, rerankerAvailable: realReranker.available, gate,
  },
  cases: { real: real.length, synthetic: synthetic.length, excluded },
  metrics: results,
  llm: usage ? { ...usage, costPer1000Rows: costPer1000Rows(usage, cases.length) } : null,
  outcomes: fullOutcomes.map((o) => ({
    id: o.id, source: o.source, predicted: o.predicted, rank: o.rank,
    confidence: Number(o.confidence.toFixed(4)), band: o.band, decidedBy: o.decidedBy, sentToLlm: o.sentToLlm,
  })),
});
writeFileSync(RESULTS, JSON.stringify(history, null, 2) + '\n');
console.log(`\nappended run ${history.runs.length} to ${RESULTS}`);

await pool.end();

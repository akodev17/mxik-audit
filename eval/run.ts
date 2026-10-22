// Matching evaluation. Reads eval/golden.csv and eval/real-*.csv (real: hand-written
// cases and customer files) and eval/synthetic.csv
// (derived from classifier names), runs the full pipeline plus one ablation per
// stage, reports real and synthetic separately, and appends the run to
// docs/eval-results.json without overwriting earlier runs.
// Run: npm run eval [-- --label "after key" --no-ablate --fulltext-common-docs N
//                       --fulltext-column plain|weighted --fulltext-select A|AB]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { embeddingProviderFromEnv } from '@tasnivo/core/embed/index';
import { matchProduct, type DisableableStage, type PositionFusion } from '@tasnivo/core/match/pipeline';
import { NoopRerankProvider, rerankFromEnv } from '@tasnivo/core/match/rerank';
import { MemoryRerankCache } from '@tasnivo/core/match/rerank-cache';
import { costPer1000Rows, formatLlmUsage } from '@tasnivo/core/match/rerank-usage';
import { PostgresCandidateStore, storeRetryCount } from '@tasnivo/core/match/store';
import { checkVectorReadiness } from '@tasnivo/core/match/vector-readiness';
import { BANDS, type VectorCalibration } from '@tasnivo/core/match/score';
import type { RerankProvider, RerankRequest, RerankUsage, RerankVerdict } from '@tasnivo/core/match/types';
import { rerankConfigFromEnv } from '@tasnivo/core/match/rerank-config';
import { OUTPUT_SCHEMA, renderRow, SYSTEM_PROMPT } from '@tasnivo/core/match/rerank-prompt';
import { lexicalQuery } from '@tasnivo/core/match/query';
import { matchKeyOf, normalizeName, tokenize } from '@tasnivo/core/normalize/index';
import { accepts, isPrefix, parseCases, type EvalCase } from './cases.js';
import { diagnoseMiss, type MissDiagnostic } from './diagnose.js';
import { MemoStore } from './memo-store.js';
import { bySet, bySource, setOf, type GroupMetrics, type Outcome } from './metrics.js';

// Customer-file sets are picked up by name, so adding one is adding a file.
const REAL_SETS = readdirSync('eval').filter((f) => /^real-.+\.csv$/.test(f)).sort().map((f) => `eval/${f}`);
const FILES = ['eval/golden.csv', ...REAL_SETS, 'eval/synthetic.csv'];
const RESULTS = 'docs/eval-results.json';
const CONCURRENCY = 6;

const argValue = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LABEL = argValue('--label') ?? 'eval';
const ABLATE = !process.argv.includes('--no-ablate');
// Ranking options under test (pipeline.ts): --position-fusion off|subposition|position,
// --nonsemantic-vector-weight N. Absent flags leave the pipeline defaults.
const positionFusionArg = argValue('--position-fusion');
const vectorWeightArg = argValue('--nonsemantic-vector-weight');
// --vector-calibration legacy | floor,ceil: how a semantic cosine becomes a signal (score.ts).
const calibrationArg = argValue('--vector-calibration');
const perPositionArg = argValue('--vector-per-position');
const calibrationBand = calibrationArg?.split(',').map(Number);
const ranking: {
  positionFusion?: PositionFusion; nonSemanticVectorWeight?: number; vectorCalibration?: VectorCalibration | null; vectorPerPosition?: number;
} = {
  ...(positionFusionArg === 'off' || positionFusionArg === 'subposition' || positionFusionArg === 'position' ? { positionFusion: positionFusionArg } : {}),
  ...(vectorWeightArg === undefined ? {} : { nonSemanticVectorWeight: Number(vectorWeightArg) }),
  ...(perPositionArg === undefined ? {} : { vectorPerPosition: Number(perPositionArg) }),
  ...(calibrationArg === 'legacy' ? { vectorCalibration: null }
    : calibrationBand?.length === 2 && calibrationBand.every(Number.isFinite)
      ? { vectorCalibration: { floor: calibrationBand[0] ?? 0.8, ceil: calibrationBand[1] ?? 0.95 } } : {}),
};

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
const commonDocs = argValue('--fulltext-common-docs');
// --fulltext-column weighted ranks on the hierarchy-aware "searchVectorWeighted"
// (opt-in, plan §3.1); --fulltext-select AB lets position words select candidates
// too (store.ts). Both default to the store's own.
const fullTextColumn = argValue('--fulltext-column');
const fullTextSelect = argValue('--fulltext-select');
// --ef-search N: HNSW search breadth (store default 100); exact scans ignore it.
const efSearchArg = argValue('--ef-search');
const baseStore = new PostgresCandidateStore(pool, {
  // The placeholder embedder's sparse vectors defeat HNSW; see store.ts.
  exactVectorScan: !embedder.semantic,
  vectorEnabled: readiness.usable,
  ...(commonDocs === undefined ? {} : { fullTextCommonDocs: Number(commonDocs) }),
  ...(fullTextColumn === 'plain' || fullTextColumn === 'weighted' ? { fullTextColumn } : {}),
  ...(fullTextSelect === 'A' || fullTextSelect === 'AB' ? { fullTextSelectWeights: fullTextSelect } : {}),
  ...(efSearchArg === undefined ? {} : { efSearch: Number(efSearchArg) }),
});
const fullTextSource = await baseStore.fullTextSource();
// Columns holding the provider's vectors; the pipeline picks the row's script's column.
const vectorColumns = readiness.stored?.columns ?? ['uz'];
const store = new MemoStore(baseStore);

// Never score against a label that is not a live classifier code, or a prefix no live code has.
const labels = [...new Set(loaded.flatMap((c) => c.correct))];
const live = await baseStore.liveCodes(labels.filter((l) => !isPrefix(l)));
for (const prefix of labels.filter(isPrefix)) {
  const hit = await pool.query('SELECT 1 FROM mxik_code WHERE code LIKE $1 AND "retiredAt" IS NULL LIMIT 1', [`${prefix.slice(0, -1)}%`]);
  if (hit.rowCount) live.add(prefix);
}
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
  /** Rows and prompt characters the gate passed during the full-pipeline config. */
  recording = false;
  rows = 0;
  promptChars = 0;
  rerank(request: RerankRequest): Promise<RerankVerdict[]> {
    if (this.recording) {
      this.rows++;
      this.promptChars += renderRow('0', request).length + 2;
    }
    return Promise.resolve([]);
  }
}
const dryRun = realReranker.available ? null : new DryRunReranker();
const reranker: RerankProvider = dryRun ?? realReranker;

/**
 * Without a key: what the full pipeline would have cost, from the prompts the
 * gate actually passed (renderRow, the real prompt text). Two assumptions,
 * printed with the estimate: ~3 characters per input token for this mixed
 * Latin/Cyrillic/code text, and ~60 output tokens per ranked code (code,
 * confidence, one Uzbek sentence) for 5 codes per row. No extended thinking.
 */
const CHARS_PER_INPUT_TOKEN = 3;
const OUTPUT_TOKENS_PER_ROW = 5 * 60;
function estimatedUsage(dry: DryRunReranker): RerankUsage {
  const config = rerankConfigFromEnv(process.env);
  const calls = Math.ceil(dry.rows / config.batchSize);
  const fixed = SYSTEM_PROMPT.length + JSON.stringify(OUTPUT_SCHEMA).length;
  const inputTokens = Math.round((dry.promptChars + calls * fixed) / CHARS_PER_INPUT_TOKEN);
  const outputTokens = dry.rows * OUTPUT_TOKENS_PER_ROW;
  return {
    model: `${config.model} (ESTIMATE, dry run)`, rowsRequested: dry.rows, rowsSent: dry.rows, cacheHits: 0, rowsFailed: 0,
    codesDiscarded: 0, apiCalls: calls, inputTokens, outputTokens, latencyMs: 0,
    estimatedCostUsd: config.price ? (inputTokens * config.price.inputPerMTok + outputTokens * config.price.outputPerMTok) / 1_000_000 : null,
  };
}

// --------------------------------------------------------------- header
const codeCount = (await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code WHERE "retiredAt" IS NULL')).rows[0]?.n ?? '?';
// Which classifier copy this is: numbers from different snapshots are not comparable.
const snapshot = (await pool.query<{ id: number; takenAt: Date }>('SELECT id, "takenAt" FROM catalog_snapshot ORDER BY id DESC LIMIT 1')).rows[0];
const classifierSnapshotId = snapshot?.id ?? null;
const classifierTakenAt = snapshot?.takenAt.toISOString() ?? null;
// The database name only, never the credentials: shared dev DB and scratch copies must be told apart.
const database = (() => {
  try {
    return new URL(DATABASE_URL).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
})();
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
console.log(`classifier      ${Number(codeCount).toLocaleString()} live codes · snapshot #${classifierSnapshotId ?? '?'} taken ${classifierTakenAt?.slice(0, 10) ?? '?'} · database ${database ?? '?'}`);
console.log(`cases           real ${real.length} · synthetic ${synthetic.length}${excluded.length ? ` · excluded ${excluded.length}` : ''}`);
for (const e of excluded) console.log(`  excluded: ${e}`);
console.log(`full-text       "${fullTextSource}"${fullTextSource === 'searchVectorWeighted' ? `, selecting on weight ${fullTextSelect ?? 'A'}` : ''}`);
console.log(`embeddings      ${embedder.name}${embedder.semantic ? '' : '   <-- NOT SEMANTIC'} · text ${embedder.textShape ?? 'folded'} · columns ${vectorColumns.join('+')}`);
if (readiness.reason) console.log(`  vector stage    ${readiness.usable ? 'SUBSTITUTED' : 'DISABLED'}: ${readiness.reason}`);
console.log(`reranker        ${realReranker.name}${realReranker.available ? '' : '   <-- DISABLED (gate measured in dry run)'}`);
console.log(`rerank gate     top-1 < ${gate.minConfidence} or margin < ${gate.minMargin}`);
console.log('');
console.log('  NOTE: "real" mixes hand-written cases (golden) with customer-file sets');
console.log('  (real-*.csv); each real set is also reported on its own below.');
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
        { store, embedder, reranker: tracked, rerankGate: gate, disabledStages: new Set(config.disabled), vectorColumns, ...ranking },
      );
      const rankIndex = result.candidates.findIndex((c) => accepts(testCase.correct, c.candidate.code));
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
        inPool: result.pool.some((c) => accepts(testCase.correct, c)),
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
const resultsBySet: Record<string, Record<string, GroupMetrics>> = {};
let fullOutcomes: Outcome[] = [];
for (const config of configs) {
  const t0 = Date.now();
  if (dryRun) dryRun.recording = config.key === 'full';
  const outcomes = await runConfig(config);
  results[config.key] = bySource(outcomes);
  resultsBySet[config.key] = bySet(outcomes);
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
table('REAL cases (hand-written and customer files together)', (m) => m.real);
const realSets = [...new Set(cases.filter((c) => c.source === 'real').map((c) => setOf(c.id)))];
for (const set of realSets) {
  console.log('');
  console.log(`real set ${set}`);
  console.log('  config                               n   top1%  top5%  high-cov%  high-prec%  pool%  llm%');
  for (const config of configs) {
    const m = resultsBySet[config.key]?.[set];
    if (!m) continue;
    console.log(`  ${config.label.padEnd(34)} ${String(m.n).padStart(4)}  ${f(m.top1Pct)}  ${f(m.top5Pct)}  ${f(m.highCoveragePct).padStart(9)}  ${f(m.highPrecisionPct).padStart(10)}  ${f(m.ceilingPct)} ${f(m.llmSharePct)}`);
  }
}
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

// Top-5 misses in tokens: the query as retrieval sees it next to the correct
// code's own words. Tells a vocabulary gap from an inflection miss (plan §5).
/**
 * The code a label stands for: itself, or for a prefix the code under it whose
 * name is closest to the query, so "Лист г/к" is compared with the position's
 * "лист горячекатаный" codes rather than with its differently worded base code.
 */
async function representative(labels: readonly string[], query: string): Promise<{ code: string; nameUz: string; nameRu: string } | null> {
  for (const label of labels) {
    const res = isPrefix(label)
      ? await pool.query<{ code: string; nameUz: string; nameRu: string }>(
        `SELECT code, "nameUz", "nameRu" FROM mxik_code WHERE code LIKE $1 AND "retiredAt" IS NULL
         ORDER BY word_similarity($2, "searchText") DESC, "isBase" DESC, code LIMIT 1`, [`${label.slice(0, -1)}%`, query])
      : await pool.query<{ code: string; nameUz: string; nameRu: string }>(
        'SELECT code, "nameUz", "nameRu" FROM mxik_code WHERE code = $1', [label]);
    const row = res.rows[0];
    if (row) return { ...row, code: row.code.trim() };
  }
  return null;
}
type MissRecord = MissDiagnostic & { id: string; query: string; correctCode: string | null };
const missDiagnostics: MissRecord[] = [];
const realMisses = fullOutcomes.filter((o) => o.source === 'real' && o.rank === null);
if (realMisses.length > 0) {
  console.log('');
  console.log('real top-5 misses in tokens (query | closest correct code\'s words; ~ = same stem, inflected)');
}
for (const o of realMisses) {
  const query = lexicalQuery(normalizeName(o.name).queryKey);
  const code = await representative(o.correct, query);
  const codeTokens = code ? [...tokenize(matchKeyOf(code.nameUz)), ...tokenize(matchKeyOf(code.nameRu))] : [];
  const d = diagnoseMiss(tokenize(query), codeTokens);
  missDiagnostics.push({ id: o.id, query, correctCode: code?.code ?? null, ...d });
  console.log(`  ${o.id}  "${query}"`);
  console.log(`      vs ${code?.code ?? '?'} "${[...new Set(codeTokens)].join(' ').slice(0, 90)}"`);
  console.log(`      shared [${d.shared.join(' ')}]  inflected [${d.inflection.join(' ')}]  query-only [${d.queryOnly.join(' ')}]`);
}
if (realMisses.length > 0) {
  const inflected = missDiagnostics.filter((m) => m.inflection.length > 0).length;
  const vocabulary = missDiagnostics.filter((m) => m.shared.length === 0 && m.inflection.length === 0).length;
  console.log(`  ${realMisses.length} misses: ${inflected} with an inflected word, ${vocabulary} sharing no word or stem with the correct code`);
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

console.log('');
console.log(`reads retried after a dropped connection: ${storeRetryCount()}`);

const usage = realReranker.usage?.() ?? null;
if (usage) {
  console.log('');
  console.log(formatLlmUsage(usage, cases.length));
}
const estimate = dryRun ? estimatedUsage(dryRun) : null;
if (estimate) {
  console.log('');
  console.log(`no reranker key: cost ESTIMATE for the full pipeline (~${CHARS_PER_INPUT_TOKEN} chars per input token, ${OUTPUT_TOKENS_PER_ROW} output tokens per row, no thinking)`);
  console.log(formatLlmUsage(estimate, cases.length));
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
  classifierSnapshotId,
  classifierTakenAt,
  database,
  providers: {
    embedding: embedder.name, embeddingSemantic: embedder.semantic, vectorUsable: readiness.usable,
    embeddingTextShape: embedder.textShape ?? 'folded', vectorColumns,
    reranker: realReranker.name, rerankerAvailable: realReranker.available, gate,
    fullText: { column: fullTextSource, selectWeights: fullTextSource === 'searchVectorWeighted' ? (fullTextSelect ?? 'A') : null },
    ranking,
    efSearch: efSearchArg === undefined ? null : Number(efSearchArg),
  },
  cases: { real: real.length, synthetic: synthetic.length, excluded },
  metrics: results,
  metricsBySet: resultsBySet,
  llm: usage ? { ...usage, costPer1000Rows: costPer1000Rows(usage, cases.length) } : null,
  llmEstimate: estimate ? { ...estimate, costPer1000Rows: costPer1000Rows(estimate, cases.length), charsPerInputToken: CHARS_PER_INPUT_TOKEN, outputTokensPerRow: OUTPUT_TOKENS_PER_ROW } : null,
  readRetries: storeRetryCount(),
  outcomes: fullOutcomes.map((o) => ({
    id: o.id, source: o.source, predicted: o.predicted, rank: o.rank,
    confidence: Number(o.confidence.toFixed(4)), band: o.band, decidedBy: o.decidedBy, sentToLlm: o.sentToLlm,
  })),
  realTop5Misses: missDiagnostics,
});
writeFileSync(RESULTS, JSON.stringify(history, null, 2) + '\n');
console.log(`\nappended run ${history.runs.length} to ${RESULTS}`);

await pool.end();

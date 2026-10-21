// Fits the ranking weights on 80% of every case set and reports the other 20%
// (plan §3.6). Retrieval is memoised, so after one warm-up pass every grid
// point re-ranks the same database answers in memory. Without a reranker key
// nothing reaches the high band on fusion (0.85 ceiling), so the weights
// cannot move high-band precision; the objective is top-1 and top-5.
//
// Objective on the training rows: the mean over sets of (top-1% + top-5%) / 2,
// each set counting once, so neither the 191 synthetic nor the 168 metal rows
// decide alone. Constraints, also on training rows only: no golden row that is
// top-1 in the baseline loses it, and synthetic top-1 drops at most 1 point.
// Appends the grid's best rows and the baseline to docs/weight-fit-results.json.
// Run: npm run eval:fit [-- --label "..." --grid capped]   (DATABASE_URL picks the copy)
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { embeddingProviderFromEnv } from '../src/core/embed/index.js';
import { matchProduct, type PositionFusion } from '../src/core/match/pipeline.js';
import { NoopRerankProvider } from '../src/core/match/rerank.js';
import type { SignalWeights } from '../src/core/match/score.js';
import { PostgresCandidateStore } from '../src/core/match/store.js';
import { checkVectorReadiness } from '../src/core/match/vector-readiness.js';
import { accepts, isPrefix, parseCases, type EvalCase } from './cases.js';
import { MemoStore } from './memo-store.js';
import { setOf } from './metrics.js';
import { holdoutIds } from './split.js';

const RESULTS = 'docs/weight-fit-results.json';
const argValue = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const LABEL = argValue('--label') ?? 'weight fit';

const files = ['eval/golden.csv', ...readdirSync('eval').filter((f) => /^real-.+\.csv$/.test(f)).sort().map((f) => `eval/${f}`), 'eval/synthetic.csv'];
const loaded: EvalCase[] = files.filter(existsSync).flatMap((file) => parseCases(readFileSync(file, 'utf8'), file.replace(/^eval\//, '')).cases);

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 8 });
const readiness = await checkVectorReadiness(pool, embeddingProviderFromEnv());
const embedder = readiness.embedder;
const base = new PostgresCandidateStore(pool, { exactVectorScan: !embedder.semantic, vectorEnabled: readiness.usable });
const store = new MemoStore(base);

// Same label check as eval/run.ts: never score against a code the classifier lacks.
const labels = [...new Set(loaded.flatMap((c) => c.correct))];
const live = await base.liveCodes(labels.filter((l) => !isPrefix(l)));
for (const prefix of labels.filter(isPrefix)) {
  const hit = await pool.query('SELECT 1 FROM mxik_code WHERE code LIKE $1 AND "retiredAt" IS NULL LIMIT 1', [`${prefix.slice(0, -1)}%`]);
  if (hit.rowCount) live.add(prefix);
}
const cases = loaded.flatMap((c) => {
  const correct = c.correct.filter((code) => live.has(code));
  return correct.length > 0 ? [{ ...c, correct }] : [];
});
const held = holdoutIds(cases.map((c) => c.id));
const reranker = new NoopRerankProvider('weight fit');

type Config = { positionFusion: PositionFusion; positionFusionCap?: number; nonSemanticVectorWeight: number | undefined; weights: SignalWeights };
const key = (c: Config): string =>
  `${c.positionFusion}${c.positionFusionCap === undefined ? "" : ` cap=${c.positionFusionCap}`} vec=${c.nonSemanticVectorWeight ?? 'signal'} lex=${c.weights.lexical} rrf=${c.weights.rrf} pos=${c.weights.positionRrf}`;

/** Rank of the first correct code in the top five, per case id; null = not there. */
async function ranks(config: Config): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      const c = cases[next++];
      if (!c) return;
      const result = await matchProduct({ rawName: c.name, barcode: c.barcode, unit: c.unit }, {
        store, embedder, reranker, vectorColumns: readiness.stored?.columns, ...config,
      });
      const i = result.candidates.findIndex((x) => accepts(c.correct, x.candidate.code));
      out.set(c.id, i === -1 ? null : i + 1);
    }
  }));
  return out;
}

type SetScore = { n: number; top1: number; top5: number };
function score(r: Map<string, number | null>, part: 'train' | 'holdout'): Record<string, SetScore> {
  const sets: Record<string, { n: number; t1: number; t5: number }> = {};
  for (const c of cases) {
    if ((part === 'holdout') !== held.has(c.id)) continue;
    const s = (sets[setOf(c.id)] ??= { n: 0, t1: 0, t5: 0 });
    const rank = r.get(c.id) ?? null;
    s.n++;
    if (rank === 1) s.t1++;
    if (rank !== null) s.t5++;
  }
  return Object.fromEntries(Object.entries(sets).map(([k, s]) => [k, { n: s.n, top1: (100 * s.t1) / s.n, top5: (100 * s.t5) / s.n }]));
}
const objective = (s: Record<string, SetScore>): number => {
  const v = Object.values(s);
  return v.reduce((a, x) => a + (x.top1 + x.top5) / 2, 0) / v.length;
};

// The committed ranking before this fit: no position pass, the stand-in counted as a real model.
const BASELINE: Config = { positionFusion: 'off', nonSemanticVectorWeight: undefined, weights: { lexical: 0.45, vector: 0.25, rrf: 0.3, positionRrf: 0 } };
const t0 = Date.now();
const baseRanks = await ranks(BASELINE); // also warms the memo
console.log(`warm-up and baseline ${((Date.now() - t0) / 1000).toFixed(0)}s, ${cases.length} cases, ${held.size} held out`);
const baseTrain = score(baseRanks, 'train');
const goldenTop1 = cases.filter((c) => setOf(c.id) === 'golden' && !held.has(c.id) && baseRanks.get(c.id) === 1).map((c) => c.id);

// --grid capped: position fusion counting at most 1 or 3 codes per position per list.
// --grid position: position fusion alone (keys, weights), the default ranking otherwise.
const CAPPED = argValue('--grid') === 'capped';
const POSITION_ONLY = argValue('--grid') === 'position';
const grid: Config[] = [];
if (CAPPED) {
  for (const positionFusion of ['position', 'subposition'] as const) {
    for (const positionFusionCap of [1, 3]) {
      for (const positionRrf of [0.1, 0.2]) {
        for (const rrf of [0.2, 0.3]) grid.push({ positionFusion, positionFusionCap, nonSemanticVectorWeight: undefined, weights: { lexical: 0.45, vector: 0.25, rrf, positionRrf } });
      }
    }
  }
}
if (POSITION_ONLY) {
  for (const positionFusion of ['position', 'subposition'] as const) {
    for (const positionRrf of [0.05, 0.1, 0.2]) {
      for (const rrf of [0.2, 0.3]) grid.push({ positionFusion, nonSemanticVectorWeight: undefined, weights: { lexical: 0.45, vector: 0.25, rrf, positionRrf } });
    }
  }
}
for (const positionFusion of CAPPED || POSITION_ONLY ? [] : ['off', 'position', 'subposition'] as const) {
  for (const positionRrf of positionFusion === 'off' ? [0] : [0.05, 0.1, 0.2]) {
    for (const nonSemanticVectorWeight of [undefined, 1, 0.5, 0.25, 0]) {
      for (const lexical of [0.35, 0.45, 0.55]) {
        for (const rrf of [0.2, 0.3]) grid.push({ positionFusion, nonSemanticVectorWeight, weights: { lexical, vector: 0.25, rrf, positionRrf } });
      }
    }
  }
}

type Row = { config: string; train: Record<string, SetScore>; holdout: Record<string, SetScore>; objective: number; holdoutObjective: number; feasible: boolean; why: string[] };
const rows: Row[] = [];
for (const config of grid) {
  const r = await ranks(config);
  const train = score(r, 'train');
  const why: string[] = [];
  const lostGolden = goldenTop1.filter((id) => r.get(id) !== 1);
  if (lostGolden.length > 0) why.push(`golden loses ${lostGolden.join(', ')}`);
  if ((train['synthetic']?.top1 ?? 0) < (baseTrain['synthetic']?.top1 ?? 0) - 1) why.push('synthetic top-1 drops > 1 point');
  const holdout = score(r, 'holdout');
  rows.push({ config: key(config), train, holdout, objective: objective(train), holdoutObjective: objective(holdout), feasible: why.length === 0, why });
}
console.log(`grid of ${grid.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

const fmt = (s: Record<string, SetScore>): string => Object.entries(s)
  .map(([k, v]) => `${k.replace('real-', '')} ${v.top1.toFixed(1)}/${v.top5.toFixed(1)}`).join(' | ');
const baseRow: Row = { config: `baseline ${key(BASELINE)}`, train: baseTrain, holdout: score(baseRanks, 'holdout'), objective: objective(baseTrain), holdoutObjective: objective(score(baseRanks, 'holdout')), feasible: true, why: [] };
const best = rows.filter((r) => r.feasible).sort((a, b) => b.objective - a.objective).slice(0, 12);
for (const r of [baseRow, ...best]) {
  console.log(`${r.objective.toFixed(2)} (hold-out ${r.holdoutObjective.toFixed(2)})  ${r.config}`);
  console.log(`    train   ${fmt(r.train)}`);
  console.log(`    holdout ${fmt(r.holdout)}`);
}
const infeasibleBest = rows.filter((r) => !r.feasible).sort((a, b) => b.objective - a.objective)[0];
if (infeasibleBest) console.log(`best excluded by a constraint: ${infeasibleBest.objective.toFixed(2)} ${infeasibleBest.config} (${infeasibleBest.why.join('; ')})`);

const history = existsSync(RESULTS) ? (JSON.parse(readFileSync(RESULTS, 'utf8')) as { runs: unknown[] }) : { runs: [] };
history.runs.push({
  label: LABEL, ranAt: new Date().toISOString(), database: new URL(DATABASE_URL).pathname.slice(1),
  embedding: embedder.name, cases: cases.length, heldOut: held.size, gridSize: grid.length,
  baseline: baseRow, best, infeasibleBest: infeasibleBest ?? null,
});
writeFileSync(RESULTS, JSON.stringify({ note: 'Append-only history of `npm run eval:fit` (plan §3.6): grid fits on 80% of every eval set, with the 20% hold-out reported.', runs: history.runs }, null, 2) + '\n');
console.log(`appended to ${RESULTS}`);
await pool.end();

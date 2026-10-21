// HNSW recall against an exact scan, on the eval rows: for every case, embed
// the row as the pipeline does and compare the index's top k with the exact
// top k in the columns the pipeline would search. e5 puts thousands of
// near-identical identifying codes (pipe sizes) almost on top of each other,
// and an index built too sparse loses whole positions there (2026-10-22: the
// m=16, ef_construction=64 index on mxik returned 1 of the 24 profile-pipe codes
// the exact scan finds). Read only.
// Run: npm run eval:recall [-- --k 50 --ef-search 100 --sets real-metal,golden]
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { embeddingProviderFromEnv } from '../src/core/embed/index.js';
import { embeddingText } from '../src/core/embed/text.js';
import { vectorColumnsFor } from '../src/core/match/pipeline.js';
import { PostgresCandidateStore } from '../src/core/match/store.js';
import { checkVectorReadiness } from '../src/core/match/vector-readiness.js';
import { normalizeName } from '../src/core/normalize/index.js';
import { parseCases, type EvalCase } from './cases.js';
import { setOf } from './metrics.js';

const argValue = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const K = Number(argValue('--k') ?? '50');
const EF = Number(argValue('--ef-search') ?? '100');
const SETS = argValue('--sets')?.split(',');

const files = ['eval/golden.csv', ...readdirSync('eval').filter((f) => /^real-.+\.csv$/.test(f)).sort().map((f) => `eval/${f}`), 'eval/synthetic.csv'];
const cases: EvalCase[] = files.filter(existsSync)
  .flatMap((file) => parseCases(readFileSync(file, 'utf8'), file.replace(/^eval\//, '')).cases)
  .filter((c) => !SETS || SETS.includes(setOf(c.id)));

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const readiness = await checkVectorReadiness(pool, embeddingProviderFromEnv());
if (!readiness.usable || !readiness.embedder.semantic) {
  throw new Error(`vector stage not usable with a semantic provider here: ${readiness.reason ?? readiness.embedder.name}`);
}
const embedder = readiness.embedder;
const columns = readiness.stored?.columns ?? ['uz'];
const hnsw = new PostgresCandidateStore(pool, { efSearch: EF });
const exact = new PostgresCandidateStore(pool, { exactVectorScan: true });

const perSet = new Map<string, { n: number; recall: number; positionsLost: number }>();
let worst: { id: string; recall: number } | null = null;
for (const c of cases) {
  const [vec] = await embedder.embed([embeddingText(c.name, 'query', embedder.textShape ?? 'folded')], 'query');
  if (!vec) continue;
  for (const column of vectorColumnsFor(normalizeName(c.name).script, columns)) {
    const [a, b] = await Promise.all([hnsw.byVector(vec, K, column), exact.byVector(vec, K, column)]);
    const truth = new Set(b.map((h) => h.candidate.code));
    const found = a.filter((h) => truth.has(h.candidate.code)).length;
    const recall = truth.size === 0 ? 1 : found / truth.size;
    // Positions the exact list holds that the index list never shows at all.
    const indexPositions = new Set(a.map((h) => h.candidate.code.slice(0, 8)));
    const lost = new Set(b.map((h) => h.candidate.code.slice(0, 8)).filter((p) => !indexPositions.has(p))).size;
    const s = perSet.get(setOf(c.id)) ?? { n: 0, recall: 0, positionsLost: 0 };
    s.n++;
    s.recall += recall;
    s.positionsLost += lost;
    perSet.set(setOf(c.id), s);
    if (!worst || recall < worst.recall) worst = { id: `${c.id} (${column})`, recall };
  }
}
console.log(`${embedder.name} · columns ${columns.join('+')} · k ${K} · hnsw.ef_search ${EF} · database ${new URL(DATABASE_URL).pathname.slice(1)}`);
for (const [set, s] of perSet) {
  console.log(`  ${set.padEnd(20)} queries ${String(s.n).padStart(4)}  mean recall@${K} ${(s.recall / s.n).toFixed(3)}  positions lost per query ${(s.positionsLost / s.n).toFixed(2)}`);
}
if (worst) console.log(`  worst: ${worst.id} recall ${worst.recall.toFixed(2)}`);
await pool.end();

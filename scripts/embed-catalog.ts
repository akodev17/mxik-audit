// Populates the vector columns, then rebuilds the HNSW indexes.
//
// Resumable: data/embed-checkpoint.json records the last code embedded, so an
// interrupted run continues where it stopped (same provider and columns).
// While it runs, embedding_state reads "rebuilding:<provider>" and the vector
// stage stays off, because old and new vectors are mixed in the table until the
// last batch. Only then is the new provider recorded.
//
// Both columns are filled by default: embeddingUz from nameUz, embeddingRu from
// nameRu, and the pipeline searches the column of the row's script (plan §5,
// 2026-10-22). --columns uz fills only embeddingUz and clears embeddingRu (never
// left holding another model's vectors). The text embedded is the provider's
// passage text (src/core/embed/text.ts), the same function the pipeline uses
// for queries; embedding_state records the provider and the columns.
//
// --no-index skips the HNSW build (measurement copies, where exact scans are fine).
//
// Run: npm run embed:catalog [-- --columns uz] [-- --restart] [-- --no-index]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { embeddingProviderFromEnv } from '@tasnivo/core/embed/index';
import { embeddingText } from '@tasnivo/core/embed/text';
import { HNSW_BUILD_SETTINGS, hnswIndexSql } from './lib/hnsw.js';
import { REBUILDING_PREFIX, writeEmbeddingState, type VectorColumn } from '@tasnivo/core/match/vector-readiness';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const BATCH = Number(process.env['EMBED_BATCH'] ?? '1000');
const CHECKPOINT = 'data/embed-checkpoint.json';

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const columns = (arg('--columns') ?? 'uz,ru').split(',').map((c) => c.trim());
const fillRu = columns.includes('ru');
const restart = process.argv.includes('--restart');
const buildIndex = !process.argv.includes('--no-index');

const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const embedder = embeddingProviderFromEnv();

const shape = embedder.textShape ?? 'folded';
console.log(`provider: ${embedder.name}  dimensions=${embedder.dimensions}  semantic=${embedder.semantic}  text=${shape}`);
console.log(`columns:  embeddingUz${fillRu ? ' + embeddingRu' : ' (embeddingRu cleared)'}`);
if (!embedder.semantic) console.log('NOTE: the local hashing stand-in, not a semantic model.');

const { rows: dims } = await pool.query<{ dim: string }>(
  `SELECT a.atttypmod::text AS dim FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname = 'mxik_code' AND a.attname = 'embeddingUz'`,
);
const columnDim = Number(dims[0]?.dim ?? 0);
if (columnDim > 0 && columnDim !== embedder.dimensions) {
  throw new Error(`column is vector(${columnDim}) but provider emits ${embedder.dimensions}`);
}

type Checkpoint = { provider: string; columns: string[]; lastCode: string; done: number; elapsedMs: number };
const saved: Checkpoint | null = existsSync(CHECKPOINT) ? (JSON.parse(readFileSync(CHECKPOINT, 'utf8')) as Checkpoint) : null;
const resuming = !restart && saved !== null && saved.provider === embedder.name && saved.columns.join() === columns.join();
let { lastCode, done, elapsedMs } = resuming && saved ? saved : { lastCode: '', done: 0, elapsedMs: 0 };

const total = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code')).rows[0]?.n ?? 0);
if (resuming) {
  console.log(`resuming after ${lastCode}: ${done.toLocaleString()} of ${total.toLocaleString()} already done`);
} else {
  console.log(`rows to embed: ${total.toLocaleString()}`);
  // Indexes would be maintained on every update; build them once at the end.
  await pool.query('DROP INDEX IF EXISTS "mxik_code_embeddingUz_hnsw"');
  await pool.query('DROP INDEX IF EXISTS "mxik_code_embeddingRu_hnsw"');
}
// From here until the end the table mixes models: keep the vector stage off.
await writeEmbeddingState(pool, { provider: `${REBUILDING_PREFIX}${embedder.name}`, dimensions: embedder.dimensions, rowsEmbedded: 0 });

const literal = (vec: readonly number[]): string => `[${vec.map((v) => v.toFixed(6)).join(',')}]`;
const started = Date.now() - elapsedMs;
const fmt = (s: number): string => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${Math.round(s / 60)}m` : `${Math.round(s)}s`);

for (;;) {
  const batch = await pool.query<{ code: string; nameUz: string; nameRu: string }>(
    `SELECT code, "nameUz", "nameRu" FROM mxik_code WHERE code > $1 ORDER BY code LIMIT $2`,
    [lastCode, BATCH],
  );
  if (batch.rows.length === 0) break;

  // The passage text in the provider's shape: what the pipeline's query text is compared with.
  const uz = (await embedder.embed(batch.rows.map((r) => embeddingText(r.nameUz, 'passage', shape)), 'passage')).map(literal);
  // A code without a Russian name is found through its Uzbek one in that column too.
  const ru = fillRu
    ? (await embedder.embed(batch.rows.map((r) => embeddingText(r.nameRu || r.nameUz, 'passage', shape)), 'passage')).map(literal)
    : null;
  const codes = batch.rows.map((r) => r.code);

  await pool.query(
    `UPDATE mxik_code AS m
     SET "embeddingUz" = v.uz::vector, "embeddingRu" = CASE WHEN $4 THEN v.ru::vector ELSE NULL END
     FROM (SELECT * FROM unnest($1::char(17)[], $2::text[], $3::text[]) AS t(code, uz, ru)) AS v
     WHERE m.code = v.code`,
    [codes, uz, ru ?? uz.map(() => null), fillRu],
  );

  lastCode = codes[codes.length - 1] ?? lastCode;
  done += batch.rows.length;
  elapsedMs = Date.now() - started;
  writeFileSync(CHECKPOINT, JSON.stringify({ provider: embedder.name, columns, lastCode, done, elapsedMs } satisfies Checkpoint));
  const rate = done / (elapsedMs / 1000);
  process.stderr.write(`  ${done.toLocaleString()} / ${total.toLocaleString()} (${((done / total) * 100).toFixed(1)}%)  ${rate.toFixed(0)}/s  ETA ${fmt((total - done) / rate)}\n`);
}

const embedSeconds = (Date.now() - started) / 1000;
console.log(`embedded ${done.toLocaleString()} rows in ${fmt(embedSeconds)} (${(done / embedSeconds).toFixed(0)}/s)`);

// HNSW after the data, so each index is built once over a full column.
if (buildIndex) console.log('building HNSW indexes (cosine)...');
else console.log('--no-index: HNSW indexes not built; vector queries scan exactly');
for (const col of !buildIndex ? [] : fillRu ? ['embeddingUz', 'embeddingRu'] as const : ['embeddingUz'] as const) {
  const t0 = Date.now();
  await pool.query(`DROP INDEX IF EXISTS "mxik_code_${col}_hnsw"`);
  // Denser than pgvector's defaults: see scripts/lib/hnsw.ts for the recall it buys.
  // One connection, so the session settings apply to the build (see HNSW_BUILD_SETTINGS).
  const client = await pool.connect();
  try {
    for (const setting of HNSW_BUILD_SETTINGS) await client.query(setting);
    await client.query(hnswIndexSql(col));
  } finally {
    client.release();
  }
  console.log(`  ${col}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await pool.query('ANALYZE mxik_code');

const filled = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code WHERE "embeddingUz" IS NOT NULL');
const rowsEmbedded = Number(filled.rows[0]?.n ?? 0);
const recorded: VectorColumn[] = fillRu ? ['uz', 'ru'] : ['uz'];
await writeEmbeddingState(pool, { provider: embedder.name, dimensions: embedder.dimensions, rowsEmbedded, columns: recorded });
rmSync(CHECKPOINT, { force: true });
console.log(`rows with embeddings: ${rowsEmbedded.toLocaleString()}; recorded embedding_state: ${embedder.name}, columns ${recorded.join('+')}`);
await pool.end();

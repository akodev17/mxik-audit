// Populates embeddingUz / embeddingRu, then builds the HNSW indexes.
// Each language variant is embedded separately (never concatenated), so a
// Russian-language catalogue row is compared against Russian text.
// Run: npm run embed:catalog
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { Pool } from 'pg';
import { embeddingProviderFromEnv } from '../src/core/embed/index.js';
import { matchKeyOf } from '../src/core/normalize/index.js';
import { writeEmbeddingState } from '../src/core/match/vector-readiness.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const BATCH = Number(process.env['EMBED_BATCH'] ?? '2000');

const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const embedder = embeddingProviderFromEnv();

console.log(`provider: ${embedder.name}  dimensions=${embedder.dimensions}  semantic=${embedder.semantic}`);
if (!embedder.semantic) {
  console.log('NOTE: this is the local surface-form stand-in, not a semantic model.');
  console.log('      Set VOYAGE_API_KEY or OPENAI_API_KEY for real embeddings.');
}

const { rows: dims } = await pool.query<{ dim: string }>(
  `SELECT a.atttypmod::text AS dim FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   WHERE c.relname = 'mxik_code' AND a.attname = 'embeddingUz'`,
);
const columnDim = Number(dims[0]?.dim ?? 0);
if (columnDim > 0 && columnDim !== embedder.dimensions) {
  throw new Error(`column is vector(${columnDim}) but provider emits ${embedder.dimensions}`);
}

const total = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code');
console.log(`rows to embed: ${Number(total.rows[0]?.n ?? 0).toLocaleString()}`);

const literal = (vec: readonly number[]): string => `[${vec.map((v) => v.toFixed(6)).join(',')}]`;

let done = 0;
const started = Date.now();
let lastCode = '';

for (;;) {
  const batch = await pool.query<{ code: string; nameUz: string; nameRu: string }>(
    `SELECT code, "nameUz", "nameRu" FROM mxik_code
     WHERE code > $1 ORDER BY code LIMIT $2`,
    [lastCode, BATCH],
  );
  if (batch.rows.length === 0) break;
  lastCode = batch.rows[batch.rows.length - 1]?.code ?? lastCode;

  // Embed the folded form: it is what queries are folded to at match time.
  const uzTexts = batch.rows.map((r) => matchKeyOf(r.nameUz));
  const ruTexts = batch.rows.map((r) => matchKeyOf(r.nameRu));
  const [uzVecs, ruVecs] = await Promise.all([embedder.embed(uzTexts), embedder.embed(ruTexts)]);

  const codes = batch.rows.map((r) => r.code);
  const uz = uzVecs.map(literal);
  const ru = ruVecs.map(literal);

  await pool.query(
    `UPDATE mxik_code AS m SET "embeddingUz" = v.uz::vector, "embeddingRu" = v.ru::vector
     FROM (SELECT * FROM unnest($1::char(17)[], $2::text[], $3::text[]) AS t(code, uz, ru)) AS v
     WHERE m.code = v.code`,
    [codes, uz, ru],
  );

  done += batch.rows.length;
  if (done % 50_000 < BATCH) {
    const rate = done / ((Date.now() - started) / 1000);
    process.stderr.write(`  embedded ${done.toLocaleString()} (${rate.toFixed(0)}/s)\n`);
  }
}

console.log(`embedded ${done.toLocaleString()} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);

// HNSW after the data, so the index is built once over a full column.
console.log('building HNSW indexes (cosine)...');
for (const col of ['embeddingUz', 'embeddingRu'] as const) {
  const t0 = Date.now();
  await pool.query(`DROP INDEX IF EXISTS "mxik_code_${col}_hnsw"`);
  await pool.query(
    `CREATE INDEX "mxik_code_${col}_hnsw" ON mxik_code
     USING hnsw ("${col}" vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
  );
  console.log(`  ${col}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
await pool.query('ANALYZE mxik_code');

const filled = await pool.query<{ n: string }>(
  'SELECT count(*)::text AS n FROM mxik_code WHERE "embeddingUz" IS NOT NULL',
);
const rowsEmbedded = Number(filled.rows[0]?.n ?? 0);
console.log(`rows with embeddings: ${rowsEmbedded.toLocaleString()}`);

// Record the provider so query time can refuse to mix models.
await writeEmbeddingState(pool, {
  provider: embedder.name, dimensions: embedder.dimensions, rowsEmbedded,
});
console.log(`recorded embedding_state: ${embedder.name}`);
await pool.end();

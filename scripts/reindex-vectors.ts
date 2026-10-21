// Rebuilds the HNSW indexes on the vector columns with the parameters in
// scripts/lib/hnsw.ts, without re-embedding and without taking the vector stage
// down: each new index is built CONCURRENTLY under a temporary name, then the
// old one is dropped CONCURRENTLY and the new one takes its name. Only the
// columns embedding_state records as filled are indexed.
// Run: npm run vectors:reindex [-- --dry-run]
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { Pool } from 'pg';
import { readEmbeddingState } from '../src/core/match/vector-readiness.js';
import { hnswIndexName, hnswIndexSql, HNSW_EF_CONSTRUCTION, HNSW_M, type VectorColumnName } from './lib/hnsw.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const DRY_RUN = process.argv.includes('--dry-run');
// Two: one held for the session settings and DDL, one for reading embedding_state.
const pool = new Pool({ connectionString: DATABASE_URL, max: 2 });
const client = await pool.connect();
try {
  const state = await readEmbeddingState(pool);
  const columns: VectorColumnName[] = (state?.columns ?? ['uz']).map((c) => (c === 'ru' ? 'embeddingRu' : 'embeddingUz'));
  console.log(`database ${new URL(DATABASE_URL).pathname.slice(1)} · provider ${state?.provider ?? '(none)'} · columns ${columns.join(', ')} · m=${HNSW_M} ef_construction=${HNSW_EF_CONSTRUCTION}${DRY_RUN ? ' · dry run' : ''}`);
  for (const column of columns) {
    const name = hnswIndexName(column);
    const current = await client.query<{ def: string; size: string }>(
      `SELECT pg_get_indexdef(c.oid) AS def, pg_size_pretty(pg_relation_size(c.oid)) AS size FROM pg_class c WHERE c.relname = $1`,
      [name],
    );
    console.log(`  ${column}: now ${current.rows[0] ? `${current.rows[0].def} (${current.rows[0].size})` : 'no index'}`);
    if (DRY_RUN) continue;
    const temp = `${name}_new`;
    const t0 = Date.now();
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${temp}"`); // a previous attempt that died half-way
    await client.query("SET maintenance_work_mem = '2GB'");
    await client.query(hnswIndexSql(column, { concurrently: true, name: temp }));
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    await client.query(`ALTER INDEX "${temp}" RENAME TO "${name}"`);
    console.log(`  ${column}: rebuilt in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  if (!DRY_RUN) await client.query('ANALYZE mxik_code');
} finally {
  client.release();
  await pool.end();
}

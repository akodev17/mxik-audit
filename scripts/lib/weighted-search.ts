// The weighted full-text column's index, shared by load:db and the backfill.
// Built CONCURRENTLY so a live database keeps answering while it builds; that
// cannot run inside a transaction, which is why no migration creates it.
import type { Client } from 'pg';
import { WEIGHTED_INDEX } from '../../src/core/match/store.js';

/** True when mxik_code has the column (the weighted_search_vector migration ran). */
export async function hasWeightedColumn(client: Client): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'mxik_code' AND column_name = 'searchVectorWeighted'`,
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Creates the GIN index if it is missing. A build that died half-way leaves an
 * invalid index that IF NOT EXISTS would keep forever, so that one is dropped
 * and rebuilt. Must be called outside a transaction.
 */
export async function ensureWeightedIndex(client: Client, log: (line: string) => void): Promise<void> {
  const existing = await client.query<{ valid: boolean }>(
    `SELECT i.indisvalid AS valid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`,
    [WEIGHTED_INDEX],
  );
  const row = existing.rows[0];
  if (row?.valid) return;
  if (row && !row.valid) {
    log(`dropping invalid index ${WEIGHTED_INDEX} left by an interrupted build`);
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${WEIGHTED_INDEX}"`);
  }
  const t0 = Date.now();
  await client.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${WEIGHTED_INDEX}" ON "mxik_code" USING gin ("searchVectorWeighted")`);
  log(`built ${WEIGHTED_INDEX} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

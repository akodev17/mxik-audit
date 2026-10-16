// Embeds only the live codes that have no vector yet — the ones a classifier
// update just added — with the same model that produced the stored vectors, so
// the table never mixes models. HNSW indexes take the new rows incrementally.
import type { Pool } from 'pg';
import { embeddingProviderFromEnv } from '../../src/core/embed/index.js';
import { checkVectorReadiness, writeEmbeddingState } from '../../src/core/match/vector-readiness.js';
import { matchKeyOf } from '../../src/core/normalize/index.js';

const BATCH = 500;

export type EmbedMissingResult = { embedded: number; skippedReason: string | null };

export async function embedMissing(pool: Pool, log: (line: string) => void = console.log): Promise<EmbedMissingResult> {
  const readiness = await checkVectorReadiness(pool, embeddingProviderFromEnv());
  if (!readiness.usable || !readiness.stored) {
    return { embedded: 0, skippedReason: readiness.reason ?? 'vector stage not usable' };
  }
  const { embedder, stored } = readiness;
  const literal = (vec: readonly number[]): string => `[${vec.map((v) => v.toFixed(6)).join(',')}]`;

  let embedded = 0;
  for (;;) {
    const batch = await pool.query<{ code: string; nameUz: string }>(
      `SELECT code, "nameUz" FROM mxik_code
       WHERE "embeddingUz" IS NULL AND "retiredAt" IS NULL ORDER BY code LIMIT $1`,
      [BATCH],
    );
    if (batch.rows.length === 0) break;
    // Same input as embed:catalog: the folded name, which is what queries become.
    const vectors = (await embedder.embed(batch.rows.map((r) => matchKeyOf(r.nameUz)))).map(literal);
    await pool.query(
      `UPDATE mxik_code AS m SET "embeddingUz" = v.vec::vector
       FROM (SELECT * FROM unnest($1::char(17)[], $2::text[]) AS t(code, vec)) AS v
       WHERE m.code = v.code`,
      [batch.rows.map((r) => r.code), vectors],
    );
    embedded += batch.rows.length;
    log(`  embedded ${embedded.toLocaleString()} new codes with ${embedder.name}`);
  }

  if (embedded > 0) {
    const filled = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code WHERE "embeddingUz" IS NOT NULL');
    await writeEmbeddingState(pool, { provider: stored.provider, dimensions: stored.dimensions, rowsEmbedded: Number(filled.rows[0]?.n ?? 0) });
  }
  return { embedded, skippedReason: null };
}

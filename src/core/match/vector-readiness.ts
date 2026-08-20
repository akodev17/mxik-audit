// Guards the vector stage against the silent-garbage failure mode: embedding a
// query with model A and comparing it to vectors stored by model B produces
// confident nonsense. Cheaper to detect than to debug.
import type { Pool } from 'pg';
import { HashingEmbeddingProvider } from '../embed/index.js';
import type { EmbeddingProvider } from './types.js';

export type StoredEmbeddingState = {
  provider: string;
  dimensions: number;
  rowsEmbedded: number;
};

export async function readEmbeddingState(pool: Pool): Promise<StoredEmbeddingState | null> {
  const res = await pool.query<{ provider: string; dimensions: number; rowsEmbedded: number }>(
    'SELECT provider, dimensions, "rowsEmbedded" FROM embedding_state WHERE id = 1',
  );
  const row = res.rows[0];
  return row ? { provider: row.provider, dimensions: Number(row.dimensions), rowsEmbedded: Number(row.rowsEmbedded) } : null;
}

export async function writeEmbeddingState(pool: Pool, state: StoredEmbeddingState): Promise<void> {
  await pool.query(
    `INSERT INTO embedding_state (id, provider, dimensions, "rowsEmbedded", "updatedAt")
     VALUES (1, $1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET
       provider = EXCLUDED.provider, dimensions = EXCLUDED.dimensions,
       "rowsEmbedded" = EXCLUDED."rowsEmbedded", "updatedAt" = now()`,
    [state.provider, state.dimensions, state.rowsEmbedded],
  );
}

export type VectorReadiness = {
  /** The provider that should actually be used for queries. */
  embedder: EmbeddingProvider;
  /** False when the vector stage cannot be trusted and should be skipped. */
  usable: boolean;
  /** True when we substituted a different provider than the caller configured. */
  substituted: boolean;
  /** Human-readable explanation, always populated when something is off. */
  reason: string | null;
  stored: StoredEmbeddingState | null;
};

/**
 * Reconciles the configured query-time provider with whatever produced the
 * stored vectors. Substitutes the local provider when that is what is stored —
 * a matching non-semantic stage beats a mismatched semantic one, and beats no
 * vector stage at all.
 */
export async function checkVectorReadiness(
  pool: Pool,
  configured: EmbeddingProvider,
): Promise<VectorReadiness> {
  const stored = await readEmbeddingState(pool);

  if (!stored || stored.rowsEmbedded === 0) {
    return {
      embedder: configured, usable: false, substituted: false, stored,
      reason: 'No embeddings are stored. Run `npm run embed:catalog`.',
    };
  }

  if (stored.provider === configured.name) {
    if (stored.dimensions !== configured.dimensions) {
      return {
        embedder: configured, usable: false, substituted: false, stored,
        reason: `Stored vectors are ${stored.dimensions}-dimensional but the provider emits ${configured.dimensions}.`,
      };
    }
    return { embedder: configured, usable: true, substituted: false, reason: null, stored };
  }

  // Mismatch. The local provider is deterministic and always available, so if it
  // is what is stored we can reproduce it exactly for queries.
  const local = new HashingEmbeddingProvider();
  if (stored.provider === local.name && stored.dimensions === local.dimensions) {
    return {
      embedder: local, usable: true, substituted: true, stored,
      reason: `Configured provider is "${configured.name}" but the stored vectors came from "${stored.provider}". `
        + 'Using the stored provider for queries so comparisons stay valid. '
        + 'Run `npm run embed:catalog` to switch the catalogue over.',
    };
  }

  return {
    embedder: configured, usable: false, substituted: false, stored,
    reason: `Stored vectors came from "${stored.provider}" but queries would use "${configured.name}". `
      + 'Comparing them is meaningless, so the vector stage is disabled. Run `npm run embed:catalog`.',
  };
}

// Postgres-backed rerank cache. Entries are scoped (an org id, or "eval"), so a
// customer's cached verdicts are never served to another org and can be
// deleted with that customer's data.
import type { Pool } from 'pg';
import { z } from 'zod';
import type { RerankCache } from './rerank-cache.js';
import type { RerankVerdict } from './types.js';

const Stored = z.array(z.object({
  code: z.string().regex(/^\d{17}$/),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
}));

export class PostgresRerankCache implements RerankCache {
  constructor(
    private readonly pool: Pool,
    private readonly scope: string,
    private readonly model: string,
  ) {}

  async get(key: string): Promise<RerankVerdict[] | null> {
    const res = await this.pool.query<{ verdicts: unknown }>(
      'SELECT verdicts FROM rerank_cache WHERE scope = $1 AND key = $2',
      [this.scope, key],
    );
    const parsed = Stored.safeParse(res.rows[0]?.verdicts);
    return parsed.success ? parsed.data : null;
  }

  async set(key: string, verdicts: readonly RerankVerdict[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO rerank_cache (scope, key, model, verdicts) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (scope, key) DO UPDATE SET verdicts = EXCLUDED.verdicts, model = EXCLUDED.model, "createdAt" = now()`,
      [this.scope, key, this.model, JSON.stringify(verdicts)],
    );
  }
}

/** Removes cached verdicts for the given keys, or for the whole scope. */
export async function purgeRerankCache(pool: Pool, scope: string, keys?: readonly string[]): Promise<number> {
  const res = keys
    ? await pool.query('DELETE FROM rerank_cache WHERE scope = $1 AND key = ANY($2::text[])', [scope, keys])
    : await pool.query('DELETE FROM rerank_cache WHERE scope = $1', [scope]);
  return res.rowCount ?? 0;
}

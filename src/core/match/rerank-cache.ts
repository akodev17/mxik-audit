// Reranker result cache, keyed by normalized name + unit. Only a hash is used as
// the key, so the key itself carries no product text. Cached verdicts are still
// re-validated against the current candidates before use.
import { createHash } from 'node:crypto';
import { resolveUnit } from '../normalize/units.js';
import { PROMPT_VERSION } from './rerank-prompt.js';
import type { RerankVerdict } from './types.js';

export type RerankCache = {
  get(key: string): Promise<RerankVerdict[] | null>;
  set(key: string, verdicts: readonly RerankVerdict[]): Promise<void>;
};

/** Same product + same unit + same model + same prompt = same key. */
export function rerankCacheKey(model: string, normalizedKey: string, unit: string | null): string {
  const resolved = resolveUnit(unit);
  const unitKey = resolved ? `id:${resolved.id}` : (unit ?? '').trim().toLowerCase();
  return createHash('sha256')
    .update([model, PROMPT_VERSION, normalizedKey, unitKey].join('\u0000'))
    .digest('hex');
}

/** Process-local cache, for tests and the eval harness. */
export class MemoryRerankCache implements RerankCache {
  private readonly entries = new Map<string, RerankVerdict[]>();

  get(key: string): Promise<RerankVerdict[] | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, verdicts: readonly RerankVerdict[]): Promise<void> {
    this.entries.set(key, [...verdicts]);
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

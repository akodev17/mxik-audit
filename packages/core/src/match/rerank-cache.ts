// Reranker result cache. An entry is stored under a hash of model + prompt +
// normalized name + unit (so deleting a catalogue can find its rows' entries)
// and is valid only for the exact candidates it was asked about (codes, and
// what the prompt showed of them, candidatePoolHashOf):
// after a classifier update changes that set, a cached "none" or ranking is a
// miss, not a stale answer. The key carries no product text.
import { createHash } from 'node:crypto';
import { resolveUnit } from '../normalize/units.js';
import { PROMPT_VERSION } from './rerank-prompt.js';
import { hierarchyPath } from './rules.js';
import type { MxikCandidate, RerankVerdict } from './types.js';

/** Verdicts plus the fingerprint of the candidate codes they judged. */
export type CachedRerank = { pool: string; verdicts: RerankVerdict[] };

export type RerankCache = {
  get(key: string): Promise<CachedRerank | null>;
  set(key: string, entry: CachedRerank): Promise<void>;
};

/** Same product + same unit + same model + same prompt = same key. */
export function rerankCacheKey(model: string, normalizedKey: string, unit: string | null): string {
  const resolved = resolveUnit(unit);
  const unitKey = resolved ? `id:${resolved.id}` : (unit ?? '').trim().toLowerCase();
  return createHash('sha256')
    .update([model, PROMPT_VERSION, normalizedKey, unitKey].join('\u0000'))
    .digest('hex');
}

/** Order-free fingerprint of the entries offered to the reranker. */
export function candidatePoolHash(codes: readonly string[]): string {
  return createHash('sha256').update([...new Set(codes)].sort().join(',')).digest('hex').slice(0, 32);
}

/**
 * The pool fingerprint over what the prompt shows of each candidate (code,
 * name, hierarchy path, kind, marking, bound unit, brand, attribute), not the
 * code alone: a classifier update that renames a code or moves it to another
 * position keeps the code set but changes what was judged, so the cached
 * verdict must not be reused. Taking a snapshot id instead would discard the
 * whole cache on every daily update. (Plan §3.7 check, 2026-10-21.)
 */
export function candidatePoolHashOf(candidates: readonly MxikCandidate[]): string {
  return candidatePoolHash(candidates.map((c) => [
    c.code, c.nameUz, hierarchyPath(c), c.isBase ? 'base' : 'id', String(c.isMarked),
    c.unitBinding, c.unitCanonical.join('/'), c.brandName ?? '', c.attributeName ?? '',
  ].join('\u0001')));
}

/** Process-local cache, for tests and the eval harness. */
export class MemoryRerankCache implements RerankCache {
  private readonly entries = new Map<string, CachedRerank>();

  get(key: string): Promise<CachedRerank | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, entry: CachedRerank): Promise<void> {
    this.entries.set(key, { pool: entry.pool, verdicts: [...entry.verdicts] });
    return Promise.resolve();
  }

  get size(): number {
    return this.entries.size;
  }
}

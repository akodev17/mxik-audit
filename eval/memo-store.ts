// Memoizes retrieval, so stage ablations re-use the same database answers
// instead of repeating ~1-2 s vector scans per case per configuration.
import type { CandidateStore, MxikCandidate } from '../src/core/match/types.js';

type Hit = { candidate: MxikCandidate; score: number };
type FullTextHit = Hit & { hierarchyWords?: string[] };

export class MemoStore implements CandidateStore {
  private readonly memo = new Map<string, Promise<unknown>>();

  constructor(private readonly inner: CandidateStore) {}

  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key);
    if (hit) return hit as Promise<T>;
    const pending = load();
    this.memo.set(key, pending);
    // A failed lookup must be retried next time, not cached.
    pending.catch(() => this.memo.delete(key));
    return pending;
  }

  byBarcode(barcode: string): Promise<MxikCandidate[]> {
    return this.once(`b:${barcode}`, () => this.inner.byBarcode(barcode));
  }
  byMatchKey(keys: readonly string[]): Promise<MxikCandidate[]> {
    return this.once(`m:${keys.join('\u0000')}`, () => this.inner.byMatchKey(keys));
  }
  byLexical(query: string, limit: number): Promise<Hit[]> {
    return this.once(`l:${limit}:${query}`, () => this.inner.byLexical(query, limit));
  }
  byFullText(query: string, limit: number): Promise<FullTextHit[]> {
    return this.once(`f:${limit}:${query}`, () => this.inner.byFullText(query, limit));
  }
  byVector(embedding: readonly number[], limit: number, column?: 'uz' | 'ru'): Promise<(Hit & { cosine?: number })[]> {
    return this.once(`v:${limit}:${column ?? ''}:${embedding.join(',')}`, () => this.inner.byVector(embedding, limit, column));
  }
  byCode(code: string): Promise<MxikCandidate | null> {
    return this.once(`c:${code}`, () => this.inner.byCode(code));
  }
  baseCodeFor(subPositionCode: string): Promise<MxikCandidate | null> {
    return this.once(`s:${subPositionCode}`, () => this.inner.baseCodeFor(subPositionCode));
  }
  liveCodes(codes: readonly string[]): Promise<Set<string>> {
    return this.once(`live:${[...codes].sort().join(',')}`, () => this.inner.liveCodes(codes));
  }
}

// The production reranker: cache first, then concurrent rows are grouped into
// one API call. Every failure rejects only the rows it touched, and the
// pipeline turns a rejection into the capped non-LLM ranking.
import { candidatePoolHashOf, rerankCacheKey, type CachedRerank, type RerankCache } from './rerank-cache.js';
import type { RerankClient } from './rerank-claude.js';
import type { RerankConfig } from './rerank-config.js';
import { rowVerdicts } from './rerank-parse.js';
import type { RerankProvider, RerankRequest, RerankUsage, RerankVerdict } from './types.js';

export type BatchedRerankerOptions = Pick<RerankConfig, 'model' | 'batchSize' | 'batchWaitMs' | 'price'> & {
  cache?: RerankCache | undefined;
};

type Pending = {
  request: RerankRequest;
  resolve: (verdicts: RerankVerdict[]) => void;
  reject: (error: Error) => void;
};

export class BatchedReranker implements RerankProvider {
  readonly available = true;
  readonly name: string;
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly counters = {
    rowsRequested: 0, rowsSent: 0, cacheHits: 0, rowsFailed: 0, codesDiscarded: 0,
    apiCalls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0,
  };

  constructor(private readonly client: RerankClient, private readonly options: BatchedRerankerOptions) {
    this.name = client.name;
  }

  async rerank(request: RerankRequest): Promise<RerankVerdict[]> {
    if (request.candidates.length === 0) return [];
    this.counters.rowsRequested++;
    const key = rerankCacheKey(this.options.model, request.normalizedKey, request.unit);
    const pool = candidatePoolHashOf(request.candidates);

    const cached = await this.readCache(key, pool, request);
    if (cached) {
      this.counters.cacheHits++;
      return cached;
    }

    try {
      const verdicts = await this.enqueue(request);
      await this.writeCache(key, { pool, verdicts });
      return verdicts;
    } catch (error) {
      this.counters.rowsFailed++;
      throw error;
    }
  }

  usage(): RerankUsage {
    const { price } = this.options;
    const c = this.counters;
    return {
      model: this.options.model,
      ...c,
      estimatedCostUsd: price
        ? (c.inputTokens * price.inputPerMTok + c.outputTokens * price.outputPerMTok) / 1_000_000
        : null,
    };
  }

  /**
   * Reuses an entry only when it judged exactly these candidates, so a
   * classifier update is never hidden behind a stale "none". A cache problem
   * must never fail a row; it only costs a fresh call.
   */
  private async readCache(key: string, pool: string, request: RerankRequest): Promise<RerankVerdict[] | null> {
    if (!this.options.cache) return null;
    try {
      const hit = await this.options.cache.get(key);
      if (!hit || hit.pool !== pool) return null;
      const offered = new Set(request.candidates.map((c) => c.code));
      const usable = hit.verdicts.filter((v) => offered.has(v.code));
      return usable.length > 0 ? usable : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, entry: CachedRerank): Promise<void> {
    if (!this.options.cache) return;
    try {
      await this.options.cache.set(key, entry);
    } catch {
      // Best effort.
    }
  }

  private enqueue(request: RerankRequest): Promise<RerankVerdict[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });
      if (this.queue.length >= this.options.batchSize) {
        this.flush();
      } else if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.options.batchWaitMs);
      }
    });
  }

  private flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.options.batchSize);
      void this.send(batch);
    }
  }

  private async send(batch: Pending[]): Promise<void> {
    const rows = batch.map((p, i) => ({ id: `r${i + 1}`, request: p.request }));
    this.counters.apiCalls++;
    this.counters.rowsSent += batch.length;
    try {
      const reply = await this.client.rankBatch(rows);
      this.counters.inputTokens += reply.inputTokens;
      this.counters.outputTokens += reply.outputTokens;
      this.counters.latencyMs += reply.latencyMs;

      batch.forEach((pending, i) => {
        if (reply.failure) {
          pending.reject(new Error(reply.failure));
          return;
        }
        const offered = pending.request.candidates.map((c) => c.code);
        const result = rowVerdicts(reply.rows.get(rows[i]?.id ?? ''), offered);
        if (!result) {
          pending.reject(new Error('no usable answer for this row'));
          return;
        }
        this.counters.codesDiscarded += result.discarded;
        pending.resolve(result.verdicts);
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const pending of batch) pending.reject(failure);
    }
  }
}

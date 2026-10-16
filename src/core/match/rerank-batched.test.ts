import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BatchedReranker } from './rerank-batched.js';
import { MemoryRerankCache, rerankCacheKey, type RerankCache } from './rerank-cache.js';
import type { BatchReply, BatchRow, RerankClient } from './rerank-claude.js';
import type { MxikCandidate, RerankRequest } from './types.js';

function candidate(code: string): MxikCandidate {
  return {
    code, nameUz: `name ${code}`, nameRu: `name ${code}`,
    groupName: null, className: null, positionName: null, subPositionName: null,
    brandName: null, attributeName: null, subPositionCode: code.slice(0, 11),
    isBase: code.endsWith('000000'), isMarked: false,
    unitBinding: 'none', unitCanonical: [], unitRaw: null, unitContainer: null, barcode: null,
  };
}

function request(name: string, codes: string[]): RerankRequest {
  return { productName: name, normalizedKey: name, unit: 'dona', candidates: codes.map(candidate) };
}

const A = '01901001003000000';
const B = '01901001003002001';

/** Answers every row by ranking its first candidate, and records each call. */
class FakeClient implements RerankClient {
  readonly name = 'fake';
  calls: BatchRow[][] = [];
  constructor(private readonly behaviour: 'ok' | 'throw' | 'refuse' | 'invent' = 'ok') {}
  rankBatch(rows: readonly BatchRow[]): Promise<BatchReply> {
    this.calls.push([...rows]);
    if (this.behaviour === 'throw') return Promise.reject(new Error('529 overloaded'));
    const usage = { inputTokens: 1000, outputTokens: 200, latencyMs: 50 };
    if (this.behaviour === 'refuse') return Promise.resolve({ rows: new Map(), failure: 'model declined the request', ...usage });
    const answers = new Map<string, unknown>(rows.map((r) => [r.id, {
      id: r.id, none: false,
      ranking: [{
        code: this.behaviour === 'invent' ? '09999999999999999' : r.request.candidates[0]?.code,
        confidence: 0.9, reason: 'fits',
      }],
    }]));
    return Promise.resolve({ rows: answers, failure: null, ...usage });
  }
}

const OPTIONS = { model: 'claude-test', batchSize: 3, batchWaitMs: 5, price: { inputPerMTok: 4, outputPerMTok: 20 } };

describe('BatchedReranker', () => {
  it('groups concurrent rows into one API call', async () => {
    const client = new FakeClient();
    const reranker = new BatchedReranker(client, OPTIONS);
    const results = await Promise.all([
      reranker.rerank(request('a', [A, B])),
      reranker.rerank(request('b', [B, A])),
    ]);
    assert.equal(client.calls.length, 1);
    assert.equal(client.calls[0]?.length, 2);
    assert.equal(results[0]?.[0]?.code, A);
    assert.equal(results[1]?.[0]?.code, B);
  });

  it('splits a queue larger than the batch size', async () => {
    const client = new FakeClient();
    const reranker = new BatchedReranker(client, OPTIONS);
    await Promise.all(['a', 'b', 'c', 'd'].map((n) => reranker.rerank(request(n, [A]))));
    assert.deepEqual(client.calls.map((c) => c.length), [3, 1]);
  });

  it('rejects every row of a failed call so the pipeline can fall back', async () => {
    const reranker = new BatchedReranker(new FakeClient('throw'), OPTIONS);
    const outcomes = await Promise.allSettled([reranker.rerank(request('a', [A])), reranker.rerank(request('b', [B]))]);
    assert.ok(outcomes.every((o) => o.status === 'rejected'));
    assert.equal(reranker.usage().rowsFailed, 2);
  });

  it('treats a refusal as a failure and still counts its tokens', async () => {
    const reranker = new BatchedReranker(new FakeClient('refuse'), OPTIONS);
    await assert.rejects(reranker.rerank(request('a', [A])), /declined/);
    assert.equal(reranker.usage().inputTokens, 1000);
  });

  it('rejects a row whose only answer is a code it was never offered', async () => {
    const reranker = new BatchedReranker(new FakeClient('invent'), OPTIONS);
    await assert.rejects(reranker.rerank(request('a', [A])), /no usable answer/);
    assert.equal(reranker.usage().codesDiscarded, 0);
  });

  it('serves a repeat row from the cache without calling the API', async () => {
    const client = new FakeClient();
    const cache = new MemoryRerankCache();
    const reranker = new BatchedReranker(client, { ...OPTIONS, cache });
    await reranker.rerank(request('a', [A, B]));
    const again = await reranker.rerank(request('a', [A, B]));
    assert.equal(client.calls.length, 1);
    assert.equal(again[0]?.code, A);
    assert.equal(reranker.usage().cacheHits, 1);
  });

  it('re-validates cached verdicts against the current candidates', async () => {
    const client = new FakeClient();
    const cache = new MemoryRerankCache();
    await cache.set(rerankCacheKey('claude-test', 'a', 'dona'), [{ code: B, confidence: 0.9, reason: 'old' }]);
    const reranker = new BatchedReranker(client, { ...OPTIONS, cache });
    // B is no longer a candidate, so the stale entry must not be used.
    const result = await reranker.rerank(request('a', [A]));
    assert.equal(client.calls.length, 1);
    assert.equal(result[0]?.code, A);
  });

  it('keeps working when the cache itself fails', async () => {
    const broken: RerankCache = {
      get: () => Promise.reject(new Error('db down')),
      set: () => Promise.reject(new Error('db down')),
    };
    const reranker = new BatchedReranker(new FakeClient(), { ...OPTIONS, cache: broken });
    const result = await reranker.rerank(request('a', [A]));
    assert.equal(result[0]?.code, A);
  });

  it('accounts tokens and estimates cost from the configured price', async () => {
    const reranker = new BatchedReranker(new FakeClient(), OPTIONS);
    await reranker.rerank(request('a', [A]));
    const usage = reranker.usage();
    assert.equal(usage.apiCalls, 1);
    assert.equal(usage.rowsSent, 1);
    // 1000 in at $4/M + 200 out at $20/M
    assert.equal(usage.estimatedCostUsd?.toFixed(4), '0.0080');
  });

  it('uses a cache key that ignores unit spelling but not the model', () => {
    assert.equal(rerankCacheKey('m', 'shakar', 'kg'), rerankCacheKey('m', 'shakar', 'кг'));
    assert.notEqual(rerankCacheKey('m', 'shakar', 'kg'), rerankCacheKey('other', 'shakar', 'kg'));
    assert.notEqual(rerankCacheKey('m', 'shakar', 'kg'), rerankCacheKey('m', 'shakar', 'dona'));
  });
});

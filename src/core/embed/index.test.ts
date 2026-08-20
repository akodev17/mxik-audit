import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMBEDDING_DIMENSIONS, EmbeddingRequestError, HashingEmbeddingProvider, embeddingProviderFromEnv } from './index.js';

const provider = new HashingEmbeddingProvider();

describe('HashingEmbeddingProvider', () => {
  it('declares itself non-semantic so callers can warn', () => {
    assert.equal(provider.semantic, false);
    assert.equal(provider.dimensions, EMBEDDING_DIMENSIONS);
  });

  it('returns one vector of the declared width per input', async () => {
    const vecs = await provider.embed(['sement', 'sut', '']);
    assert.equal(vecs.length, 3);
    for (const v of vecs) assert.equal(v.length, EMBEDDING_DIMENSIONS);
  });

  it('is deterministic', async () => {
    const [a] = await provider.embed(['portlandsement']);
    const [b] = await provider.embed(['portlandsement']);
    assert.deepEqual(a, b);
  });

  it('produces unit vectors for non-empty input', async () => {
    const [v] = await provider.embed(['portlandsement m400']);
    const norm = Math.sqrt((v ?? []).reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-9, `norm was ${norm}`);
  });

  it('returns an all-zero vector for empty input rather than NaN', async () => {
    const [v] = await provider.embed(['']);
    assert.ok(v?.every((x) => x === 0));
  });

  it('places similar strings closer than unrelated ones', async () => {
    const [a, b, c] = await provider.embed(['portlandsement', 'portlandsement m400', 'tirik eshaklar']);
    const dot = (x: number[], y: number[]): number => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    assert.ok(dot(a ?? [], b ?? []) > dot(a ?? [], c ?? []));
  });

  it('handles an empty batch', async () => {
    assert.deepEqual(await provider.embed([]), []);
  });
});

describe('embeddingProviderFromEnv', () => {
  it('falls back to the local provider with no keys', () => {
    assert.equal(embeddingProviderFromEnv({}).semantic, false);
  });

  it('selects a remote provider when a key is present', () => {
    assert.equal(embeddingProviderFromEnv({ VOYAGE_API_KEY: 'x' }).semantic, true);
    assert.equal(embeddingProviderFromEnv({ OPENAI_API_KEY: 'x' }).semantic, true);
  });

  it('prefers Voyage when both keys are set', () => {
    const p = embeddingProviderFromEnv({ VOYAGE_API_KEY: 'x', OPENAI_API_KEY: 'y' });
    assert.match(p.name, /^voyage:/);
  });

  it('honours an explicit request for the local provider', () => {
    const p = embeddingProviderFromEnv({ VOYAGE_API_KEY: 'x', EMBEDDING_PROVIDER: 'hashing' });
    assert.equal(p.semantic, false);
  });

  it('always emits the width the schema pins', () => {
    for (const env of [{}, { VOYAGE_API_KEY: 'x' }, { OPENAI_API_KEY: 'x' }]) {
      assert.equal(embeddingProviderFromEnv(env).dimensions, EMBEDDING_DIMENSIONS);
    }
  });
});

describe('EmbeddingRequestError retry policy', () => {
  it('treats an exhausted quota as permanent, not transient', () => {
    // OpenAI reports insufficient_quota as 429; retrying it never succeeds.
    const body = '{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}';
    const err = new EmbeddingRequestError('x', 429, false);
    assert.equal(err.retryable, false);
    assert.match(body, /insufficient_quota/);
  });

  it('carries the status through for diagnosis', () => {
    const err = new EmbeddingRequestError('boom', 503, true);
    assert.equal(err.status, 503);
    assert.equal(err.retryable, true);
    assert.equal(err.name, 'EmbeddingRequestError');
    assert.ok(err instanceof Error);
  });
});

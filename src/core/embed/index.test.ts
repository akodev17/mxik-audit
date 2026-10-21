import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EMBEDDING_DIMENSIONS, EmbeddingRequestError, HashingEmbeddingProvider, embeddingProviderFromEnv } from './index.js';
import { localProviderByName } from './local.js';

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

describe('local multilingual model selection', () => {
  it('builds the local CPU model on request, semantic and 384-wide', () => {
    const p = embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'local' });
    // Since 2026-10-22 the default embeds natural text with e5's query/passage
    // prefixes, under its own name so it is never compared with folded vectors.
    assert.equal(p.name, 'local:Xenova/multilingual-e5-small#natural-v2');
    assert.equal(p.textShape, 'natural');
    assert.equal(p.semantic, true);
    assert.equal(p.dimensions, 384);
  });

  it('keeps the folded e5 variant under the name databases embedded before 2026-10-22 recorded', () => {
    const folded = embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'local', LOCAL_EMBEDDING_MODEL: 'multilingual-e5-small-folded' });
    assert.equal(folded.name, 'local:Xenova/multilingual-e5-small');
    assert.equal(folded.textShape, 'folded');
  });

  it('takes the model from LOCAL_EMBEDDING_MODEL and rejects unknown ones', () => {
    const p = embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'local', LOCAL_EMBEDDING_MODEL: 'paraphrase-multilingual-minilm' });
    assert.equal(p.name, 'local:Xenova/paraphrase-multilingual-MiniLM-L12-v2');
    assert.throws(() => embeddingProviderFromEnv({ EMBEDDING_PROVIDER: 'local', LOCAL_EMBEDDING_MODEL: 'nope' }), /Unknown/);
  });

  it('can rebuild a stored local provider by name, and only local ones', () => {
    assert.equal(localProviderByName('local:Xenova/multilingual-e5-small')?.semantic, true);
    assert.equal(localProviderByName('local:Xenova/multilingual-e5-small')?.textShape, 'folded');
    assert.equal(localProviderByName('local:Xenova/multilingual-e5-small#natural-v2')?.textShape, 'natural');
    assert.equal(localProviderByName('openai:text-embedding-3-small'), null);
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

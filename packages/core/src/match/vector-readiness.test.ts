import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { HashingEmbeddingProvider } from '../embed/index.js';
import { LOCAL_MODELS, LocalEmbeddingProvider } from '../embed/local.js';
import { REBUILDING_PREFIX, checkVectorReadiness, readEmbeddingState } from './vector-readiness.js';

/** A pool whose embedding_state row is whatever the test says. */
function poolWith(state: { provider: string; dimensions: number; rowsEmbedded: number; columns?: string[] } | null): Pool {
  return { query: () => Promise.resolve({ rows: state ? [{ row: state }] : [] }) } as unknown as Pool;
}

const e5 = LOCAL_MODELS['multilingual-e5-small'];
if (!e5) throw new Error('model table changed');

describe('checkVectorReadiness', () => {
  it('keeps the vector stage off while a backfill is rewriting vectors', async () => {
    const r = await checkVectorReadiness(
      poolWith({ provider: `${REBUILDING_PREFIX}local:${e5.id}`, dimensions: 384, rowsEmbedded: 0 }),
      new HashingEmbeddingProvider(),
    );
    assert.equal(r.usable, false);
    assert.match(r.reason ?? '', /being rebuilt/);
  });

  it('uses a stored local model for queries even when nothing is configured', async () => {
    const r = await checkVectorReadiness(
      poolWith({ provider: `local:${e5.id}`, dimensions: 384, rowsEmbedded: 442_719 }),
      new HashingEmbeddingProvider(),
    );
    assert.equal(r.usable, true);
    assert.equal(r.substituted, true);
    assert.equal(r.embedder.name, `local:${e5.id}`);
    assert.equal(r.embedder.semantic, true);
  });

  it('still substitutes the hashing stand-in when that is what is stored', async () => {
    const hashing = new HashingEmbeddingProvider();
    const r = await checkVectorReadiness(
      poolWith({ provider: hashing.name, dimensions: 384, rowsEmbedded: 10 }),
      new LocalEmbeddingProvider(e5),
    );
    assert.equal(r.usable, true);
    assert.equal(r.embedder.name, hashing.name);
  });

  it('refuses to compare against vectors from a remote model it cannot reproduce', async () => {
    const r = await checkVectorReadiness(
      poolWith({ provider: 'openai:text-embedding-3-small', dimensions: 384, rowsEmbedded: 10 }),
      new LocalEmbeddingProvider(e5),
    );
    assert.equal(r.usable, false);
  });

  it('uses the configured provider when it matches what is stored', async () => {
    const local = new LocalEmbeddingProvider(e5);
    const r = await checkVectorReadiness(poolWith({ provider: local.name, dimensions: 384, rowsEmbedded: 10 }), local);
    assert.equal(r.usable, true);
    assert.equal(r.substituted, false);
  });

  it('queries vectors stored from folded text with the folded variant, never the natural one', async () => {
    const folded = LOCAL_MODELS['multilingual-e5-small-folded'];
    if (!folded) throw new Error('model table changed');
    // The database still holds the pre-2026-10-22 shape; the configured default is natural-v2.
    const r = await checkVectorReadiness(
      poolWith({ provider: 'local:Xenova/multilingual-e5-small', dimensions: 384, rowsEmbedded: 442_964 }),
      new LocalEmbeddingProvider(e5),
    );
    assert.equal(r.usable, true);
    assert.equal(r.substituted, true);
    assert.equal(r.embedder.name, 'local:Xenova/multilingual-e5-small');
    assert.equal(r.embedder.textShape, 'folded');
    assert.notEqual(new LocalEmbeddingProvider(e5).name, r.embedder.name);
  });
});

describe('readEmbeddingState columns', () => {
  it('reads the recorded columns, and uz only where the column does not exist yet', async () => {
    const both = await readEmbeddingState(poolWith({ provider: 'x', dimensions: 384, rowsEmbedded: 1, columns: ['uz', 'ru'] }));
    assert.deepEqual(both?.columns, ['uz', 'ru']);
    const old = await readEmbeddingState(poolWith({ provider: 'x', dimensions: 384, rowsEmbedded: 1 }));
    assert.deepEqual(old?.columns, ['uz']);
    const junk = await readEmbeddingState(poolWith({ provider: 'x', dimensions: 384, rowsEmbedded: 1, columns: ['fr'] }));
    assert.deepEqual(junk?.columns, ['uz']);
  });
});

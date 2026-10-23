// Q1: a long-lived process keeps one embedding provider per name instead of one per audit.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EmbeddingProvider } from '@tasnivo/core/match/types';
import { keptEmbedders } from './audit-runner';

const fake = (name: string): EmbeddingProvider => ({ name, dimensions: 3, semantic: true, embed: () => Promise.resolve([]) });

describe('keptEmbedders (Q1)', () => {
  it('returns the first provider built under a name for every later call', () => {
    let built = 0;
    const source = keptEmbedders(() => { built += 1; return fake('local:e5-small'); });
    const a = source.configured();
    const b = source.configured();
    assert.equal(a, b);
    assert.equal(built, 2, 'the factory may run, but its result is dropped for the kept one');
    assert.deepEqual(source.names(), ['local:e5-small']);
  });

  it('reuse swaps an equal provider readiness rebuilt for the kept one, and keeps a new name', () => {
    const source = keptEmbedders(() => fake('hashing'));
    const first = source.reuse(fake('local:e5-small'));
    assert.equal(source.reuse(fake('local:e5-small')), first);
    assert.deepEqual(source.names(), ['local:e5-small']);
    source.configured();
    assert.deepEqual(source.names().sort(), ['hashing', 'local:e5-small']);
  });
});

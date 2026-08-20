import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RRF_K, reciprocalRankFusion } from './fusion.js';

const id = (s: string): string => s;

describe('reciprocalRankFusion', () => {
  it('rewards agreement over a single strong opinion', () => {
    // B is second in both lists; A is first in one and absent from the other.
    const fused = reciprocalRankFusion(
      [
        { name: 'lex', items: ['A', 'B'] },
        { name: 'vec', items: ['C', 'B'] },
      ],
      id,
    );
    assert.equal(fused[0]?.item, 'B');
  });

  it('keeps a unanimous first place first', () => {
    const fused = reciprocalRankFusion(
      [
        { name: 'lex', items: ['A', 'B', 'C'] },
        { name: 'vec', items: ['A', 'C', 'B'] },
      ],
      id,
    );
    assert.equal(fused[0]?.item, 'A');
    assert.equal(fused[0]?.normalized, 1);
  });

  it('normalizes into 0..1 with 1 only for rank 1 everywhere', () => {
    const fused = reciprocalRankFusion(
      [{ name: 'a', items: ['X', 'Y'] }, { name: 'b', items: ['X', 'Y'] }],
      id,
    );
    assert.equal(fused[0]?.normalized, 1);
    assert.ok((fused[1]?.normalized ?? 1) < 1);
    for (const f of fused) {
      assert.ok(f.normalized >= 0 && f.normalized <= 1, `${f.normalized} out of range`);
    }
  });

  it('records the rank an item held in each list', () => {
    const fused = reciprocalRankFusion(
      [{ name: 'lex', items: ['A', 'B'] }, { name: 'vec', items: ['B'] }],
      id,
    );
    const b = fused.find((f) => f.item === 'B');
    assert.deepEqual(b?.ranks, { lex: 2, vec: 1 });
  });

  it('handles empty lists without dividing by zero', () => {
    assert.deepEqual(reciprocalRankFusion([], id), []);
    assert.deepEqual(reciprocalRankFusion([{ name: 'a', items: [] }], id), []);
  });

  it('ignores an empty list when computing the best possible score', () => {
    const withEmpty = reciprocalRankFusion(
      [{ name: 'a', items: ['X'] }, { name: 'b', items: [] }],
      id,
    );
    // X is rank 1 in the only non-empty list, so it is a perfect result.
    assert.equal(withEmpty[0]?.normalized, 1);
  });

  it('is deterministic when scores tie', () => {
    const lists = [{ name: 'a', items: ['B', 'A'] }, { name: 'b', items: ['A', 'B'] }];
    const first = reciprocalRankFusion(lists, id).map((f) => f.item);
    const second = reciprocalRankFusion(lists, id).map((f) => f.item);
    assert.deepEqual(first, second);
    // Tie broken by key, so A precedes B.
    assert.deepEqual(first, ['A', 'B']);
  });

  it('uses the documented damping constant', () => {
    const fused = reciprocalRankFusion([{ name: 'a', items: ['X'] }], id);
    assert.equal(fused[0]?.score, 1 / (RRF_K + 1));
  });

  it('de-duplicates by key across lists', () => {
    const fused = reciprocalRankFusion(
      [{ name: 'a', items: ['X', 'X'] }, { name: 'b', items: ['X'] }],
      id,
    );
    assert.equal(fused.length, 1);
  });
});

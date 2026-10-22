import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitLayout, layoutFor } from './columns.js';

describe('grid columns', () => {
  it('fit a 17-digit code and the longest status chip', () => {
    const all = layoutFor([], true);
    assert.deepEqual(all.keys, ['select', 'no', 'product', 'status', 'current', 'suggested', 'match', 'decision']);
    assert.match(all.template, /minmax\(172px,1fr\)/);
    assert.equal(all.minWidth, 36 + 52 + 200 + 188 + 172 + 180 + 152 + 232);
  });

  it('give viewers no selection column', () => {
    assert.equal(layoutFor([], false).keys.includes('select'), false);
  });

  it('keep every column when there is no width limit or it fits', () => {
    assert.equal(fitLayout([], true, null).keys.length, 8);
    assert.equal(fitLayout([], true, 2000).keys.length, 8);
  });

  it('drop match, then the suggestion, then the status until the rest fits', () => {
    const all = layoutFor([], true).minWidth;
    assert.deepEqual(fitLayout([], true, all - 1).keys, ['select', 'no', 'product', 'status', 'current', 'suggested', 'decision']);
    assert.deepEqual(fitLayout([], true, 900).keys, ['select', 'no', 'product', 'status', 'current', 'decision']);
    assert.deepEqual(fitLayout([], true, 500).keys, ['select', 'no', 'product', 'current', 'decision']);
  });

  it('never drops the current code, and keeps what the user already hid hidden', () => {
    assert.ok(fitLayout([], true, 100).keys.includes('current'));
    assert.equal(fitLayout(['status'], true, 5000).keys.includes('status'), false);
  });
});

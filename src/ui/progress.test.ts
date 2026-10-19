import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { progressPercent } from './progress';

describe('progressPercent', () => {
  it('rounds to whole percent', () => {
    assert.equal(progressPercent(1, 3), 33);
    assert.equal(progressPercent(2, 3), 67);
    assert.equal(progressPercent(400, 400), 100);
  });

  it('clamps out-of-range values and handles an empty range', () => {
    assert.equal(progressPercent(-5, 100), 0);
    assert.equal(progressPercent(150, 100), 100);
    assert.equal(progressPercent(3, 0), 0);
    assert.equal(progressPercent(Number.NaN, 10), 0);
  });
});

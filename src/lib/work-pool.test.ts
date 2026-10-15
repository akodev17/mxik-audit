import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runPool } from './work-pool.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('runPool', () => {
  it('runs every item, never more than the concurrency at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick(2);
      seen.push(item);
      inFlight--;
    });
    assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(peak, 3);
  });

  it('starts nothing after a failure and lets running items finish first', async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const run = runPool([0, 1, 2, 3, 4, 5, 6, 7], 2, async (item) => {
      started.push(item);
      if (item === 1) throw new Error('row 1 failed');
      await tick(10);
      finished.push(item);
    });
    await assert.rejects(run, /row 1 failed/);
    // Item 0 was in flight when 1 failed: it finished before the rejection.
    assert.deepEqual(finished, [0]);
    assert.deepEqual(started, [0, 1]);
  });

  it('reports the first failure when several items fail', async () => {
    await assert.rejects(runPool([1, 2], 2, async (item) => {
      await tick(item);
      throw new Error(`failed ${item}`);
    }), /failed 1/);
  });

  it('accepts an empty list', async () => {
    await runPool([], 4, () => Promise.reject(new Error('never called')));
  });
});

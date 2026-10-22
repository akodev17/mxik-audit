// The daily job's classifier step: when it starts an update, with the clock, the
// newest snapshot, the lock and the starter all replaced by fakes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dailyClassifierUpdate, type DailyUpdateDeps } from './classifier-start.js';

const NOW = new Date('2026-10-22T10:00:00Z');
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

function fakes(takenAt: Date | null, running: boolean) {
  const calls = { running: 0, start: 0 };
  const deps: DailyUpdateDeps = {
    snapshot: () => Promise.resolve(takenAt ? { takenAt } : null),
    running: () => { calls.running++; return Promise.resolve(running); },
    start: () => { calls.start++; return { pid: 4242, log: 'data/classifier-update.log' }; },
  };
  return { deps, calls };
}

describe('daily classifier update', () => {
  it('starts one when the snapshot is two months old and none runs', async () => {
    const { deps, calls } = fakes(daysAgo(61), false);
    const result = await dailyClassifierUpdate(NOW, deps);
    assert.deepEqual(result, { started: true, ageDays: 61, pid: 4242, log: 'data/classifier-update.log' });
    assert.equal(calls.start, 1);
  });

  it('does nothing for a snapshot younger than a day, without looking at the lock', async () => {
    const { deps, calls } = fakes(new Date(NOW.getTime() - 5 * 3_600_000), false);
    assert.deepEqual(await dailyClassifierUpdate(NOW, deps), { started: false, reason: 'fresh', ageDays: 0 });
    assert.equal(calls.start, 0);
    assert.equal(calls.running, 0);
  });

  it('does nothing while an update is running', async () => {
    const { deps, calls } = fakes(daysAgo(3), true);
    assert.deepEqual(await dailyClassifierUpdate(NOW, deps), { started: false, reason: 'running', ageDays: 3 });
    assert.equal(calls.start, 0);
  });

  it('does not start a first import', async () => {
    const { deps, calls } = fakes(null, false);
    assert.deepEqual(await dailyClassifierUpdate(NOW, deps), { started: false, reason: 'no-snapshot', ageDays: null });
    assert.equal(calls.start, 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageInDays, bannerReasons, olderThan, resolveLastUpdate, updateDecision, type LastUpdate,
} from './classifier-freshness.js';

const NOW = new Date('2026-10-22T10:00:00Z');
const daysAgo = (days: number, extraHours = 0): Date => new Date(NOW.getTime() - (days * 24 + extraHours) * 3_600_000);
const failed = (at: Date): LastUpdate => ({ outcome: 'failed', at, message: 'fetch-catalog exited with 1' });
const succeeded = (at: Date): LastUpdate => ({ outcome: 'success', at, message: null });

describe('classifier age', () => {
  it('counts whole days and never goes negative', () => {
    assert.equal(ageInDays(daysAgo(0, 5), NOW), 0);
    assert.equal(ageInDays(daysAgo(2, 23), NOW), 2);
    assert.equal(ageInDays(daysAgo(61), NOW), 61);
    assert.equal(ageInDays(new Date(NOW.getTime() + 3_600_000), NOW), 0);
  });

  it('is "older than" strictly: exactly N days is not yet old', () => {
    assert.equal(olderThan(daysAgo(7), 7, NOW), false);
    assert.equal(olderThan(daysAgo(7, 1), 7, NOW), true);
  });
});

describe('banner condition', () => {
  it('shows nothing for a fresh copy that updated fine', () => {
    assert.deepEqual(bannerReasons({ takenAt: daysAgo(1) }, succeeded(daysAgo(1)), NOW), []);
    assert.deepEqual(bannerReasons({ takenAt: daysAgo(7) }, null, NOW), []);
  });

  it('shows "stale" once the snapshot is more than 7 days old', () => {
    assert.deepEqual(bannerReasons({ takenAt: daysAgo(7, 1) }, null, NOW), ['stale']);
    assert.deepEqual(bannerReasons({ takenAt: daysAgo(63) }, succeeded(daysAgo(63)), NOW), ['stale']);
  });

  it('shows "failed" for a fresh copy whose last update failed', () => {
    assert.deepEqual(bannerReasons({ takenAt: daysAgo(2) }, failed(daysAgo(1)), NOW), ['failed']);
  });

  it('can show both reasons', () => {
    assert.deepEqual(bannerReasons({ takenAt: daysAgo(30) }, failed(daysAgo(1)), NOW), ['stale', 'failed']);
  });

  it('has nothing to age without a snapshot', () => {
    assert.deepEqual(bannerReasons(null, failed(daysAgo(1)), NOW), []);
  });
});

describe('last update', () => {
  const snapshot = { takenAt: daysAgo(3) };

  it('keeps a failure only while it is newer than the newest snapshot', () => {
    assert.equal(resolveLastUpdate(snapshot, failed(daysAgo(1)))?.outcome, 'failed');
    const superseded = resolveLastUpdate(snapshot, failed(daysAgo(4)));
    assert.equal(superseded?.outcome, 'success');
    assert.equal(superseded?.at.getTime(), snapshot.takenAt.getTime());
  });

  it('falls back to the snapshot date when nothing was recorded', () => {
    assert.deepEqual(resolveLastUpdate(snapshot, null), { outcome: 'success', at: snapshot.takenAt, message: null });
    assert.equal(resolveLastUpdate(null, null), null);
  });

  it('prefers a recorded success that is not older than the snapshot', () => {
    const later = daysAgo(2);
    assert.equal(resolveLastUpdate(snapshot, succeeded(later))?.at.getTime(), later.getTime());
  });
});

describe('daily update decision', () => {
  it('starts an update when the snapshot is more than a day old and none runs', () => {
    assert.deepEqual(updateDecision({ takenAt: daysAgo(1, 1) }, false, NOW), { run: true });
    assert.deepEqual(updateDecision({ takenAt: daysAgo(60) }, false, NOW), { run: true });
  });

  it('leaves a snapshot of a day or less alone', () => {
    assert.deepEqual(updateDecision({ takenAt: daysAgo(0, 3) }, false, NOW), { run: false, reason: 'fresh' });
    assert.deepEqual(updateDecision({ takenAt: daysAgo(1) }, false, NOW), { run: false, reason: 'fresh' });
  });

  it('does not start a second update while one runs', () => {
    assert.deepEqual(updateDecision({ takenAt: daysAgo(60) }, true, NOW), { run: false, reason: 'running' });
  });

  it('does not start a first import', () => {
    assert.deepEqual(updateDecision(null, false, NOW), { run: false, reason: 'no-snapshot' });
  });
});

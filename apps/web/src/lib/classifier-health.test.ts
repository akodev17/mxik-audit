// The classifier fields of /api/health: shape from a fixed state, the status
// file round trip, and (database up) the route and the shared advisory lock.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Pool } from 'pg';
import { GET as health } from '@/app/api/health/route';
import { classifierHealth } from '@tasnivo/domain/classifier-health';
import { acquireClassifierLock, classifierUpdateRunning, releaseClassifierLock } from '@tasnivo/domain/classifier-lock';
import type { ClassifierState } from '@tasnivo/domain/classifier-state';
import { readUpdateStatus, tidyMessage, writeUpdateStatus } from '@tasnivo/domain/classifier-status';
import { db } from '@tasnivo/db';
import { dbSkipReason } from '@tasnivo/domain/test-fixtures';

const takenAt = new Date('2026-09-20T05:00:00Z');
const state = (over: Partial<ClassifierState> = {}): ClassifierState => ({
  takenAt, ageDays: 32, codeCount: 442_719,
  lastUpdate: { outcome: 'success', at: takenAt, message: null },
  banner: ['stale'], ...over,
});

describe('classifierHealth', () => {
  it('reports takenAt, age, code count, staleness and the last update', () => {
    assert.deepEqual(classifierHealth(true, state()), {
      loaded: true, takenAt: '2026-09-20T05:00:00.000Z', ageDays: 32, codeCount: 442_719, stale: true,
      lastUpdate: { outcome: 'success', at: '2026-09-20T05:00:00.000Z', message: null },
    });
  });

  it('carries the failure time and message, and is not stale when fresh', () => {
    const at = new Date('2026-10-21T04:00:10Z');
    const h = classifierHealth(true, state({ ageDays: 1, banner: ['failed'], lastUpdate: { outcome: 'failed', at, message: 'download failed' } }));
    assert.equal(h.stale, false);
    assert.deepEqual(h.lastUpdate, { outcome: 'failed', at: '2026-10-21T04:00:10.000Z', message: 'download failed' });
  });

  it('is all nulls when nothing is loaded', () => {
    assert.deepEqual(classifierHealth(false, null), { loaded: false, takenAt: null, ageDays: null, codeCount: null, stale: false, lastUpdate: null });
  });
});

describe('update status file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'classifier-status-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a failure and a success', () => {
    const path = join(dir, 'nested', 'status.json');
    const at = new Date('2026-10-21T04:00:00Z');
    writeUpdateStatus('failed', 'scripts/fetch-catalog.ts exited with 1', at, path);
    assert.deepEqual(readUpdateStatus(path), { outcome: 'failed', at, message: 'scripts/fetch-catalog.ts exited with 1' });
    writeUpdateStatus('success', null, at, path);
    assert.deepEqual(readUpdateStatus(path), { outcome: 'success', at, message: null });
  });

  it('reads a missing or damaged file as "nothing recorded"', () => {
    assert.equal(readUpdateStatus(join(dir, 'absent.json')), null);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    assert.equal(readUpdateStatus(bad), null);
    writeFileSync(bad, JSON.stringify({ outcome: 'success', at: 'yesterday' }));
    assert.equal(readUpdateStatus(bad), null);
  });

  it('keeps the message to one bounded line', () => {
    const tidy = tidyMessage(`line one\n   at stack ${'x'.repeat(500)}`);
    assert.ok(!tidy.includes('\n'));
    assert.ok(tidy.length <= 300);
  });
});

const skip = await dbSkipReason();

describe('health route and update lock (database)', { skip }, () => {
  after(async () => { await db.$disconnect(); });

  it('answers with the classifier block', async () => {
    const res = await health();
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; database: boolean; classifier: ReturnType<typeof classifierHealth> };
    assert.equal(body.status, 'ok');
    assert.equal(body.database, true);
    assert.equal(body.classifier.loaded, true);
    assert.equal(typeof body.classifier.takenAt, 'string');
    assert.ok(Number.isInteger(body.classifier.ageDays) && (body.classifier.ageDays ?? -1) >= 0);
    assert.ok((body.classifier.codeCount ?? 0) > 0);
    assert.equal(typeof body.classifier.stale, 'boolean');
    assert.ok(body.classifier.lastUpdate === null || ['success', 'failed'].includes(body.classifier.lastUpdate.outcome));
  });

  it('sees the advisory lock the update script holds', async () => {
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik', max: 2 });
    const holder = await pool.connect();
    const rival = await pool.connect();
    try {
      assert.equal(await classifierUpdateRunning(), false);
      assert.equal(await acquireClassifierLock(holder), true);
      assert.equal(await classifierUpdateRunning(), true);
      assert.equal(await acquireClassifierLock(rival), false, 'a second update must be refused');
      await releaseClassifierLock(holder);
      assert.equal(await classifierUpdateRunning(), false);
    } finally {
      await releaseClassifierLock(holder).catch(() => undefined);
      holder.release();
      rival.release();
      await pool.end();
    }
  });
});

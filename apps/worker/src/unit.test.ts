import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STARTUP_STALE_MS } from '@tasnivo/domain/audit-jobs';
import { auditConcurrency, workerConfig } from './config.js';
import { JsonLogger, logLine } from './logger.js';
import { decideAudit, finalAttempt } from './processors/audit-decision.js';

describe('decideAudit', () => {
  const queuedAt = Date.parse('2026-10-22T10:00:00Z');
  const now = queuedAt + 60_000;

  it('runs a catalogue still analyzing, from its stored watermark', () => {
    assert.deepEqual(decideAudit({ status: 'analyzing', progressDone: 0, auditHeartbeatAt: new Date(queuedAt - 5) }, queuedAt, now), { run: true, fromRow: 0 });
    // A crash left row 40 as the watermark; the job was queued with 0.
    assert.deepEqual(decideAudit({ status: 'analyzing', progressDone: 40, auditHeartbeatAt: new Date(queuedAt - 600_000) }, queuedAt, now), { run: true, fromRow: 40 });
  });

  it('skips a catalogue that is gone or no longer analyzing', () => {
    assert.deepEqual(decideAudit(null, queuedAt, now), { run: false, reason: 'missing' });
    assert.deepEqual(decideAudit({ status: 'ready', progressDone: 5, auditHeartbeatAt: null }, queuedAt, now), { run: false, reason: 'not-analyzing' });
    assert.deepEqual(decideAudit({ status: 'failed', progressDone: 0, auditHeartbeatAt: null }, queuedAt, now), { run: false, reason: 'not-analyzing' });
  });

  it('leaves a catalogue another process beats for after the job was queued', () => {
    const fresh = new Date(now - 1_000);
    assert.deepEqual(decideAudit({ status: 'analyzing', progressDone: 3, auditHeartbeatAt: fresh }, queuedAt, now), { run: false, reason: 'running-elsewhere' });
  });

  it('takes over once that heartbeat has gone quiet', () => {
    const quiet = new Date(now - STARTUP_STALE_MS - 1);
    assert.deepEqual(decideAudit({ status: 'analyzing', progressDone: 3, auditHeartbeatAt: quiet }, queuedAt - STARTUP_STALE_MS * 2, now), { run: true, fromRow: 3 });
  });
});

describe('finalAttempt', () => {
  it('is true once BullMQ has counted every allowed attempt', () => {
    assert.equal(finalAttempt({ attemptsMade: 1, opts: { attempts: 3 } }), false);
    assert.equal(finalAttempt({ attemptsMade: 3, opts: { attempts: 3 } }), true);
    assert.equal(finalAttempt({ attemptsMade: 1, opts: {} }), true);
  });
});

describe('worker configuration', () => {
  it('needs REDIS_URL and defaults the rest', () => {
    assert.throws(() => workerConfig({}), /REDIS_URL/);
    assert.deepEqual(workerConfig({ REDIS_URL: 'redis://r:6379' }), {
      redisUrl: 'redis://r:6379', auditConcurrency: 1, port: 4100, shutdownGraceMs: 25_000, prefix: 'bull',
    });
  });

  it('reads AUDIT_CONCURRENCY, WORKER_PORT and the grace period, and refuses nonsense', () => {
    const c = workerConfig({ REDIS_URL: 'redis://r', AUDIT_CONCURRENCY: '2', WORKER_PORT: '4200', WORKER_SHUTDOWN_GRACE_MS: '60000' });
    assert.equal(c.auditConcurrency, 2);
    assert.equal(c.port, 4200);
    assert.equal(c.shutdownGraceMs, 60_000);
    assert.throws(() => workerConfig({ REDIS_URL: 'redis://r', AUDIT_CONCURRENCY: '0' }), /AUDIT_CONCURRENCY/);
    assert.equal(auditConcurrency({}), 1);
    assert.equal(auditConcurrency({ AUDIT_CONCURRENCY: '3' }), 3);
    assert.throws(() => auditConcurrency({ AUDIT_CONCURRENCY: 'many' }), /AUDIT_CONCURRENCY/);
  });
});

describe('JSON logging', () => {
  it('writes one object per line with the context and the fields given', () => {
    const line = JSON.parse(logLine('info', { msg: 'audit started', catalogId: 'c1', jobId: 'c1' }, 'AuditProcessor')) as Record<string, unknown>;
    assert.equal(line['level'], 'info');
    assert.equal(line['ctx'], 'AuditProcessor');
    assert.equal(line['catalogId'], 'c1');
    assert.equal(line['msg'], 'audit started');
    assert.ok(typeof line['t'] === 'string');
  });

  it('sends errors to stderr with the stack Nest passes', () => {
    const out: { line: string; stream: string }[] = [];
    const logger = new JsonLogger((line, stream) => out.push({ line, stream }));
    logger.log('plain text', 'Ctx');
    logger.error('boom', 'Error: boom\n    at x', 'Ctx');
    assert.equal(out[0]?.stream, 'out');
    assert.deepEqual(JSON.parse(out[0]?.line ?? '{}'), { ...JSON.parse(out[0]?.line ?? '{}'), msg: 'plain text', ctx: 'Ctx' });
    const err = JSON.parse(out[1]?.line ?? '{}') as Record<string, unknown>;
    assert.equal(out[1]?.stream, 'err');
    assert.equal(err['stack'], 'Error: boom\n    at x');
    assert.equal(err['ctx'], 'Ctx');
  });
});

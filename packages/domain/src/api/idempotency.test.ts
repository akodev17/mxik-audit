import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { fingerprint, idempotent, pruneIdempotency, readIdempotencyKey } from './idempotency.js';
import { createApiKey } from './keys.js';
import type { Outcome } from './respond.js';

const skip = await dbSkipReason();
const HOUR = 3_600_000;

describe('Idempotency-Key header', () => {
  it('accepts 1..255 visible ASCII characters, or nothing', () => {
    assert.deepEqual(readIdempotencyKey(new Headers()), { ok: true, key: null });
    assert.deepEqual(readIdempotencyKey(new Headers({ 'Idempotency-Key': ' abc-123 ' })), { ok: true, key: 'abc-123' });
    assert.deepEqual(readIdempotencyKey(new Headers({ 'Idempotency-Key': 'a'.repeat(256) })), { ok: false });
    assert.deepEqual(readIdempotencyKey(new Headers({ 'Idempotency-Key': 'two words' })), { ok: false });
    assert.deepEqual(readIdempotencyKey(new Headers({ 'Idempotency-Key': '' })), { ok: false });
  });
});

describe('idempotent requests (database)', { skip }, () => {
  let a: TestActor;
  let keyA = '';
  let keyB = '';
  before(async () => {
    a = await makeOrg();
    await createApiKey({ ...a, role: 'admin' }, 'first');
    await createApiKey({ ...a, role: 'admin' }, 'second');
    const keys = await db.apiKey.findMany({ where: { orgId: a.orgId }, orderBy: { createdAt: 'asc' } });
    keyA = keys[0]?.id ?? '';
    keyB = keys[1]?.id ?? '';
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  const counter = () => {
    let runs = 0;
    const job = (): Promise<Outcome> => Promise.resolve({ status: 202, body: { id: `run-${++runs}`, at: new Date('2026-10-01T00:00:00Z') } });
    return { job, runs: () => runs };
  };

  it('a repeat returns the first response and does not run again', async () => {
    const c = counter();
    const first = await idempotent(keyA, 'order-1', fingerprint('same'), c.job);
    const second = await idempotent(keyA, 'order-1', fingerprint('same'), c.job);
    assert.equal(first.kind, 'fresh');
    assert.equal(second.kind, 'replayed');
    assert.equal(c.runs(), 1);
    assert.ok(first.kind === 'fresh' && second.kind === 'replayed');
    assert.equal(second.outcome.status, 202);
    assert.deepEqual(second.outcome.body, JSON.parse(JSON.stringify(first.outcome.body)));
  });

  it('the same key value under two API keys does not collide', async () => {
    const c = counter();
    const one = await idempotent(keyA, 'shared', fingerprint('x'), c.job);
    const two = await idempotent(keyB, 'shared', fingerprint('x'), c.job);
    assert.equal(one.kind, 'fresh');
    assert.equal(two.kind, 'fresh');
    assert.equal(c.runs(), 2);
  });

  it('the same key with a different request is refused', async () => {
    const c = counter();
    await idempotent(keyA, 'order-2', fingerprint('file A'), c.job);
    const reused = await idempotent(keyA, 'order-2', fingerprint('file B'), c.job);
    assert.equal(reused.kind, 'reused');
    assert.equal(c.runs(), 1);
  });

  it('a failed request is not stored, so it can be retried with the same key', async () => {
    let runs = 0;
    const failing = (): Promise<Outcome> => { runs++; return Promise.resolve({ status: 402, body: { error: { code: 'plan_limit', message: 'x' } } }); };
    assert.equal((await idempotent(keyA, 'order-3', fingerprint('y'), failing)).kind, 'fresh');
    assert.equal((await idempotent(keyA, 'order-3', fingerprint('y'), failing)).kind, 'fresh');
    assert.equal(runs, 2);
    assert.equal(await db.apiIdempotency.count({ where: { keyId: keyA, idemKey: 'order-3' } }), 0);
  });

  it('a request still running answers in_progress; a dead one is taken over', async () => {
    const now = new Date();
    await db.apiIdempotency.create({ data: { keyId: keyA, idemKey: 'running', status: 0, response: { fingerprint: fingerprint('z'), body: null }, createdAt: now } });
    const c = counter();
    assert.equal((await idempotent(keyA, 'running', fingerprint('z'), c.job, now)).kind, 'in_progress');
    assert.equal((await idempotent(keyA, 'running', fingerprint('z'), c.job, new Date(now.getTime() + HOUR))).kind, 'fresh');
    assert.equal(c.runs(), 1);
  });

  it('after 24 hours a key starts afresh, and the daily job prunes old rows', async () => {
    const c = counter();
    const then = new Date(Date.now() - 25 * HOUR);
    await idempotent(keyA, 'old', fingerprint('o'), c.job, then);
    assert.equal((await idempotent(keyA, 'old', fingerprint('o'), c.job)).kind, 'fresh');
    await idempotent(keyB, 'old-b', fingerprint('o'), c.job, then);
    assert.ok((await pruneIdempotency()) >= 1);
    assert.equal(await db.apiIdempotency.count({ where: { keyId: keyB, idemKey: 'old-b' } }), 0);
  });
});

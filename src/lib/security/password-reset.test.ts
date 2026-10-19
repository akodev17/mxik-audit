import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '../db.js';
import { hashPassword, verifyPassword } from '../password.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { issueToken } from './email-token.js';
import { changePassword } from './password-change.js';
import { issueResetToken, resetPassword, resetTarget } from './password-reset.js';
import { createRecord, isLive } from './session-store.js';
import { confirmEmail } from './verification.js';

const skip = await dbSkipReason();
const HOUR = 3_600_000;

describe('password reset and change (database)', { skip }, () => {
  let a: TestActor;

  before(async () => {
    a = await makeOrg();
    await db.user.update({ where: { id: a.userId }, data: { passwordHash: await hashPassword('old-password'), emailVerifiedAt: null } });
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('a reset link works once, sets the password, confirms the address and ends every session', async () => {
    const sid = await createRecord(a.userId, a.orgId, 'test');
    const token = await issueResetToken(a.userId);
    assert.ok(await resetTarget(token));
    assert.deepEqual(await resetPassword(token, 'new-password-1'), { ok: true });
    const user = await db.user.findUniqueOrThrow({ where: { id: a.userId } });
    assert.ok(await verifyPassword('new-password-1', user.passwordHash));
    assert.ok(user.emailVerifiedAt, 'the mailbox was proven');
    assert.equal(await isLive(sid, a.userId), false);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'security.password_reset', targetId: a.userId } }));

    assert.deepEqual(await resetPassword(token, 'another-password'), { ok: false, error: 'bad' });
    assert.equal(await resetTarget(token), null);
  });

  it('expires after an hour', async () => {
    const token = await issueResetToken(a.userId, new Date(Date.now() - 2 * HOUR));
    assert.equal(await resetTarget(token), null);
    assert.deepEqual(await resetPassword(token, 'new-password-2'), { ok: false, error: 'bad' });
  });

  it('only the newest link counts', async () => {
    const first = await issueResetToken(a.userId);
    const second = await issueResetToken(a.userId);
    assert.deepEqual(await resetPassword(first, 'new-password-3'), { ok: false, error: 'bad' });
    assert.deepEqual(await resetPassword(second, 'new-password-3'), { ok: true });
  });

  it('refuses a short password without using the link up', async () => {
    const token = await issueResetToken(a.userId);
    assert.deepEqual(await resetPassword(token, 'short'), { ok: false, error: 'short' });
    assert.ok(await resetTarget(token));
  });

  it('keeps verify and reset tokens apart', async () => {
    const verify = await issueToken(a.userId, 'verify', HOUR);
    assert.deepEqual(await resetPassword(verify, 'new-password-4'), { ok: false, error: 'bad' });
    const reset = await issueResetToken(a.userId);
    assert.equal(await confirmEmail(reset), null);
    assert.ok(await confirmEmail(verify));
  });

  it('changing the password needs the current one and ends the other sessions only', async () => {
    await db.user.update({ where: { id: a.userId }, data: { passwordHash: await hashPassword('current-pass') } });
    const keep = await createRecord(a.userId, a.orgId, 'this browser');
    const other = await createRecord(a.userId, a.orgId, 'other browser');
    assert.deepEqual(await changePassword(a, 'wrong', 'next-password', keep), { ok: false, error: 'wrong' });
    assert.deepEqual(await changePassword(a, 'current-pass', 'short', keep), { ok: false, error: 'short' });
    const done = await changePassword(a, 'current-pass', 'next-password', keep);
    assert.equal(done.ok, true);
    assert.equal(await isLive(keep, a.userId), true);
    assert.equal(await isLive(other, a.userId), false);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'security.password_changed', actorId: a.userId } }));
  });
});

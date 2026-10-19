import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { createRecord, isLive } from './security/session-store.js';
import { changeMember, removeTeamMember, revokeTeamInvite } from './team-members.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();
const tag = (): string => randomBytes(4).toString('hex');
const chatId = (): string => String(8_000_000_000 + randomBytes(3).readUIntBE(0, 3));

async function member(orgId: string, role: 'admin' | 'accountant' | 'viewer'): Promise<string> {
  const user = await db.user.create({ data: { orgId, email: `test-${tag()}@test.local`, passwordHash: 'x', role } });
  return user.id;
}

describe('team members (database)', { skip }, () => {
  let a: TestActor;
  let other: TestActor;
  before(async () => {
    a = await makeOrg();
    other = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId, other.orgId]);
    await db.$disconnect();
  });

  it('the only admin cannot be demoted, not even by themselves', async () => {
    const result = await changeMember(a, { userId: a.userId, role: 'viewer', access: 'all', clientIds: [] });
    assert.deepEqual(result, { ok: false, reason: 'last_admin' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.userId } })).role, 'admin');
  });

  it('with a second admin, an admin may step down', async () => {
    const second = await member(a.orgId, 'admin');
    const result = await changeMember(a, { userId: second, role: 'accountant', access: 'all', clientIds: [] });
    assert.deepEqual(result, { ok: true, clients: 0 });
    const event = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'team.updated', targetId: second } });
    assert.deepEqual(event?.payload, { role: 'accountant', previousRole: 'admin', access: 'all', clients: 0 });
  });

  it('"selected clients" needs at least one client of the org', async () => {
    const viewer = await member(a.orgId, 'viewer');
    const foreign = await db.client.create({ data: { orgId: other.orgId, name: `test-${tag()}` } });
    assert.deepEqual(await changeMember(a, { userId: viewer, role: 'viewer', access: 'selected', clientIds: [] }), { ok: false, reason: 'no_clients' });
    assert.deepEqual(await changeMember(a, { userId: viewer, role: 'viewer', access: 'selected', clientIds: [foreign.id] }), { ok: false, reason: 'no_clients' });
    const own = await db.client.create({ data: { orgId: a.orgId, name: `test-${tag()}` } });
    assert.deepEqual(await changeMember(a, { userId: viewer, role: 'viewer', access: 'selected', clientIds: [own.id, foreign.id] }), { ok: true, clients: 1 });
    const assigned = await db.clientAssignment.findMany({ where: { userId: viewer } });
    assert.deepEqual(assigned.map((x) => x.clientId), [own.id]);
    assert.deepEqual(await changeMember(a, { userId: viewer, role: 'viewer', access: 'all', clientIds: [own.id] }), { ok: true, clients: 0 });
    assert.equal(await db.clientAssignment.count({ where: { userId: viewer } }), 0);
  });

  it('cannot touch a member of another org', async () => {
    assert.deepEqual(await changeMember(a, { userId: other.userId, role: 'viewer', access: 'all', clientIds: [] }), { ok: false, reason: 'not_found' });
    assert.deepEqual(await removeTeamMember(a, other.userId), { ok: false, reason: 'not_found' });
  });

  it('an admin cannot remove themselves', async () => {
    assert.deepEqual(await removeTeamMember(a, a.userId), { ok: false, reason: 'self' });
  });

  it('removing a member ends their sessions, unlinks the Telegram chats they linked and revokes their invites', async () => {
    const leaving = await member(a.orgId, 'admin');
    const sid = await createRecord(leaving, a.orgId, 'test');
    const theirs = chatId();
    const mine = chatId();
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId: theirs, linkedBy: leaving } });
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId: mine, linkedBy: a.userId } });
    await db.telegramLinkCode.create({ data: { code: tag().toUpperCase().padEnd(8, 'X'), orgId: a.orgId, userId: leaving, expiresAt: new Date(Date.now() + 60_000) } });
    await db.invite.create({ data: { orgId: a.orgId, tokenHash: tag(), role: 'viewer', clientIds: [], createdBy: leaving, expiresAt: new Date(Date.now() + 86_400_000) } });

    const result = await removeTeamMember(a, leaving);
    assert.ok(result.ok);
    assert.equal(result.sessionsEnded, 1);
    assert.equal(result.telegramUnlinked, 1);
    assert.equal(result.invitesRevoked, 1);
    assert.equal(await isLive(sid, leaving), false);
    assert.equal(await db.user.findUnique({ where: { id: leaving } }), null);
    assert.equal(await db.telegramLink.findUnique({ where: { chatId: theirs } }), null);
    assert.ok(await db.telegramLink.findUnique({ where: { chatId: mine } }), 'chats other members linked stay');
    assert.equal(await db.telegramLinkCode.count({ where: { userId: leaving } }), 0);
    assert.equal(await db.invite.count({ where: { createdBy: leaving } }), 0);
    const event = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'team.removed', targetId: leaving } });
    assert.ok(event);
    assert.equal((event.payload as { sessionsEnded: number }).sessionsEnded, 1);
    assert.equal((event.payload as { telegramUnlinked: number }).telegramUnlinked, 1);
  });

  it('revoking an invite deletes it and logs it; another org cannot', async () => {
    const invite = await db.invite.create({ data: { orgId: a.orgId, tokenHash: tag(), email: 'x@test.local', role: 'viewer', clientIds: [], expiresAt: new Date(Date.now() + 86_400_000) } });
    assert.deepEqual(await revokeTeamInvite(other, invite.id), { ok: false, reason: 'not_found' });
    assert.deepEqual(await revokeTeamInvite(a, invite.id), { ok: true });
    assert.equal(await db.invite.findUnique({ where: { id: invite.id } }), null);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'team.invite_revoked', targetId: invite.id } }));
  });
});

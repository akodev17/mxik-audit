import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { createRecord, isLive } from './security/session-store.js';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import { memberEmails } from './member-emails.js';
import { changeMember, memberRemovalCheck, removeTeamMember, revokeTeamInvite } from './team-members.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();
const tag = (): string => randomBytes(4).toString('hex');
const chatId = (): string => String(8_000_000_000 + randomBytes(3).readUIntBE(0, 3));

async function member(orgId: string, role: 'admin' | 'accountant' | 'viewer'): Promise<string> {
  const user = await db.user.create({ data: { orgId, email: `test-${tag()}@test.local`, passwordHash: 'x', role } });
  return user.id;
}

type Admin = TestActor & { role: 'admin' };
const asAdmin = (t: TestActor): Admin => ({ ...t, role: 'admin' });

describe('team members (database)', { skip }, () => {
  let a: Admin;
  let other: Admin;
  before(async () => {
    a = asAdmin(await makeOrg());
    other = asAdmin(await makeOrg());
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

  it('refusing to remove the last admin signs nobody out', async () => {
    const solo = await makeOrg();
    try {
      const accountant = await member(solo.orgId, 'accountant');
      const sid = await createRecord(solo.userId, solo.orgId, 'test');
      const key = await db.apiKey.create({ data: { orgId: solo.orgId, name: 'k', prefix: 'mxk_test', tokenHash: `test-${tag()}`, createdBy: solo.userId } });
      // A session that still says "admin" while its user was demoted meanwhile reaches the lock.
      assert.deepEqual(await removeTeamMember({ orgId: solo.orgId, userId: accountant, role: 'admin' }, solo.userId), { ok: false, reason: 'last_admin' });
      assert.equal(await isLive(sid, solo.userId), true, 'the session survives a refused removal');
      assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt, null);
    } finally {
      await dropOrgs([solo.orgId]);
    }
  });

  it('removing a member revokes the API keys they created, and only theirs', async () => {
    const leaving = await member(a.orgId, 'accountant');
    const theirs = await db.apiKey.create({ data: { orgId: a.orgId, name: 'their key', prefix: 'mxk_aaaaaa', tokenHash: `test-${tag()}`, createdBy: leaving } });
    const old = await db.apiKey.create({ data: { orgId: a.orgId, name: 'old', prefix: 'mxk_bbbbbb', tokenHash: `test-${tag()}`, createdBy: leaving, revokedAt: new Date('2026-01-01') } });
    const mine = await db.apiKey.create({ data: { orgId: a.orgId, name: 'my key', prefix: 'mxk_cccccc', tokenHash: `test-${tag()}`, createdBy: a.userId } });

    const result = await removeTeamMember(a, leaving);
    assert.ok(result.ok);
    assert.equal(result.apiKeysRevoked, 1);
    assert.ok((await db.apiKey.findUniqueOrThrow({ where: { id: theirs.id } })).revokedAt);
    assert.deepEqual((await db.apiKey.findUniqueOrThrow({ where: { id: old.id } })).revokedAt, new Date('2026-01-01'), 'an already revoked key keeps its date');
    assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: mine.id } })).revokedAt, null, 'keys of other members stay live');
    const revoked = await db.auditEvent.findMany({ where: { orgId: a.orgId, action: 'apikey.revoked', targetId: { in: [theirs.id, old.id, mine.id] } } });
    assert.deepEqual(revoked.map((e) => e.targetId), [theirs.id]);
    const removed = await db.auditEvent.findFirstOrThrow({ where: { orgId: a.orgId, action: 'team.removed', targetId: leaving } });
    const payload = removed.payload as { apiKeysRevoked: number; apiKeyIds: string[] };
    assert.equal(payload.apiKeysRevoked, 1);
    assert.deepEqual(payload.apiKeyIds, [theirs.id]);
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
    assert.equal(result.apiKeysRevoked, 0);
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

  it('a member with open reviews is removed only when they are handed over or dropped on purpose (F18)', async () => {
    const c1 = await makeClient(a.orgId, `R1-${tag()}`);
    const c2 = await makeClient(a.orgId, `R2-${tag()}`);
    const leaving = await makePerson(a.orgId, 'accountant', [c1, c2]);
    const narrow = await makePerson(a.orgId, 'accountant', [c1]);
    const wide = await makePerson(a.orgId, 'accountant', [c1, c2]);
    const watcher = await makePerson(a.orgId, 'viewer');
    const reviews: { id: string }[] = [];
    for (const clientId of [c1, c2]) {
      const { catalogId } = await makeClientCatalog(a.orgId, clientId, [{ name: 'x', findings: [{}] }]);
      reviews.push(await db.reviewAssignment.create({ data: { orgId: a.orgId, clientId, catalogId, assigneeId: leaving.userId } }));
    }

    const check = await memberRemovalCheck(a, leaving.userId);
    assert.equal(check?.openReviews, 2);
    const takers = check?.reassignTo.map((p) => p.id) ?? [];
    assert.ok(takers.includes(wide.userId) && takers.includes(a.userId));
    assert.ok(!takers.includes(narrow.userId) && !takers.includes(watcher.userId) && !takers.includes(leaving.userId), 'only members who see both clients');
    assert.equal(await memberRemovalCheck(other, leaving.userId), null);

    assert.deepEqual(await removeTeamMember(a, leaving.userId), { ok: false, reason: 'open_reviews', openReviews: 2 });
    assert.deepEqual(await removeTeamMember(a, leaving.userId, { reassignTo: narrow.userId }), { ok: false, reason: 'bad_reassign' });
    assert.deepEqual(await removeTeamMember(a, leaving.userId, { reassignTo: watcher.userId }), { ok: false, reason: 'bad_reassign' });
    assert.ok(await db.user.findUnique({ where: { id: leaving.userId } }), 'a refused removal changes nothing');

    const done = await removeTeamMember(a, leaving.userId, { reassignTo: wide.userId });
    assert.ok(done.ok);
    assert.equal(done.reviewsReassigned, 2);
    const moved = await db.reviewAssignment.findMany({ where: { id: { in: reviews.map((r) => r.id) } } });
    assert.equal(moved.length, 2);
    assert.ok(moved.every((r) => r.assigneeId === wide.userId && r.revision === 2));
    const event = await db.auditEvent.findFirstOrThrow({ where: { orgId: a.orgId, action: 'team.removed', targetId: leaving.userId } });
    assert.equal((event.payload as { openReviews: number }).openReviews, 2);
    assert.equal((event.payload as { reviewsReassignedTo: string }).reviewsReassignedTo, wide.email);

    // Dropping is explicit, and its count is kept too.
    const second = await makePerson(a.orgId, 'accountant', [c1]);
    const { catalogId } = await makeClientCatalog(a.orgId, c1, [{ name: 'y', findings: [{}] }]);
    await db.reviewAssignment.create({ data: { orgId: a.orgId, clientId: c1, catalogId, assigneeId: second.userId } });
    const dropped = await removeTeamMember(a, second.userId, { dropReviews: true });
    assert.ok(dropped.ok);
    assert.equal(dropped.reviewsDropped, 1);
    assert.equal(await db.reviewAssignment.count({ where: { catalogId } }), 0);
    const dropEvent = await db.auditEvent.findFirstOrThrow({ where: { orgId: a.orgId, action: 'team.removed', targetId: second.userId } });
    assert.equal((dropEvent.payload as { reviewsDropped: number }).reviewsDropped, 1);
    // Their address stays readable for what they decided and closed.
    assert.equal((await memberEmails(a.orgId, [second.userId])).get(second.userId), second.email);
  });

  it('a non-admin actor is refused and nothing changes', async () => {
    const target = await member(a.orgId, 'viewer');
    for (const role of ['accountant', 'viewer'] as const) {
      const actor = { orgId: a.orgId, userId: a.userId, role };
      assert.deepEqual(await changeMember(actor, { userId: target, role: 'admin', access: 'all', clientIds: [] }), { ok: false, reason: 'forbidden' });
      assert.deepEqual(await removeTeamMember(actor, target), { ok: false, reason: 'forbidden' });
    }
    const invite = await db.invite.create({ data: { orgId: a.orgId, tokenHash: tag(), role: 'viewer', clientIds: [], expiresAt: new Date(Date.now() + 86_400_000) } });
    assert.deepEqual(await revokeTeamInvite({ orgId: a.orgId, userId: a.userId, role: 'viewer' }, invite.id), { ok: false, reason: 'forbidden' });
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: target } })).role, 'viewer');
    assert.equal(await db.invite.count({ where: { id: invite.id } }), 1);
  });

  it('demoting an admin revokes their API keys, unlinks their chats and drops their link codes', async () => {
    const leaving = await member(a.orgId, 'admin');
    const key = await db.apiKey.create({ data: { orgId: a.orgId, name: 'k', prefix: 'mxk_dddddd', tokenHash: `test-${tag()}`, createdBy: leaving } });
    const mine = await db.apiKey.create({ data: { orgId: a.orgId, name: 'mine', prefix: 'mxk_eeeeee', tokenHash: `test-${tag()}`, createdBy: a.userId } });
    const theirs = chatId();
    await db.telegramLink.create({ data: { orgId: a.orgId, chatId: theirs, linkedBy: leaving } });
    await db.telegramLinkCode.create({ data: { code: tag().toUpperCase().padEnd(8, 'Y'), orgId: a.orgId, userId: leaving, expiresAt: new Date(Date.now() + 60_000) } });
    const own = await db.client.create({ data: { orgId: a.orgId, name: `test-${tag()}` } });

    assert.deepEqual(await changeMember(a, { userId: leaving, role: 'accountant', access: 'selected', clientIds: [own.id] }), { ok: true, clients: 1 });
    assert.ok((await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt);
    assert.equal((await db.apiKey.findUniqueOrThrow({ where: { id: mine.id } })).revokedAt, null, 'keys of other admins stay live');
    assert.equal(await db.telegramLink.findUnique({ where: { chatId: theirs } }), null);
    assert.equal(await db.telegramLinkCode.count({ where: { userId: leaving, usedAt: null } }), 0);
    const event = await db.auditEvent.findFirstOrThrow({ where: { orgId: a.orgId, action: 'team.updated', targetId: leaving } });
    assert.deepEqual(event.payload, { role: 'accountant', previousRole: 'admin', access: 'selected', clients: 1, apiKeysRevoked: 1, telegramUnlinked: 1, apiKeyIds: [key.id] });
    const revoked = await db.auditEvent.findFirstOrThrow({ where: { orgId: a.orgId, action: 'apikey.revoked', targetId: key.id } });
    assert.equal((revoked.payload as { reason: string }).reason, 'member_demoted');

    // Promoting them back restores nothing: the revoked key stays revoked.
    assert.deepEqual(await changeMember(a, { userId: leaving, role: 'admin', access: 'all', clientIds: [] }), { ok: true, clients: 0 });
    assert.ok((await db.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt);
  });

  it('revoking an invite deletes it and logs it; another org cannot', async () => {
    const invite = await db.invite.create({ data: { orgId: a.orgId, tokenHash: tag(), email: 'x@test.local', role: 'viewer', clientIds: [], expiresAt: new Date(Date.now() + 86_400_000) } });
    assert.deepEqual(await revokeTeamInvite(other, invite.id), { ok: false, reason: 'not_found' });
    assert.deepEqual(await revokeTeamInvite(a, invite.id), { ok: true });
    assert.equal(await db.invite.findUnique({ where: { id: invite.id } }), null);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'team.invite_revoked', targetId: invite.id } }));
  });
});

// endpoints.team against the development database: the team page's data, invites, joining with
// one (which signs the new member in, unconfirmed until the mailed code), joining with an existing
// account (plan D5), member changes and removal.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { db } from '@tasnivo/db';
import { issueCode } from '@tasnivo/domain/security/email-code';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, startApp, testIp } from '../helpers';
import { client, Fixtures, quietEnv, sessionCookie, sessionPair, unsealPair } from '../session-helpers';

const skip = await dbSkipReason();
const { ta } = i18nFor('uz');
const s = ta.setX.team;

type Invite = { url?: string; email?: string | null; emailed?: boolean; existingAccount?: string; error?: string; fieldErrors?: { email?: string; clients?: string } };
type Team = {
  members: { id: string; email: string; role: string; clientIds: string[] }[];
  invites: { id: string; email: string | null; role: string; clientIds: string[]; expiresAt: string }[];
  clients: { id: string; name: string; archived: boolean }[];
  seatsOpen: boolean; mailEnabled: boolean; inviteDays: number;
};

describe('team (database)', { skip }, () => {
  let app: INestApplication;
  let call: ReturnType<typeof client>;
  const fx = new Fixtures();
  const restoreEnv = quietEnv();

  before(async () => {
    app = await startApp();
    call = client(app);
  });
  after(async () => {
    await app.close();
    await fx.drop();
    restoreEnv();
    await db.$disconnect();
  });

  it('invites by link and by address, the team page lists them; the checks answer as the form did', async () => {
    const u = await fx.user({ plan: 'firm' });
    const admin = await sessionCookie(u);
    const client1 = await db.client.create({ data: { orgId: u.orgId, name: 'Alfa' } });

    const link = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'link' }));
    assert.match(link.url ?? '', /\/invite\/[\w-]+$/);
    assert.deepEqual([link.email, link.emailed], [null, false]);
    const email = `new-${testIp()}@example.com`.toLowerCase();
    const byMail = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'accountant', kind: 'email', email: `  ${email.toUpperCase()} `, access: 'selected', clientIds: [client1.id] }));
    assert.deepEqual([byMail.email, byMail.emailed], [email, false]);

    assert.deepEqual(bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email })), { fieldErrors: { email: s.invite.pendingExists } });
    assert.deepEqual(bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email: u.email })), { fieldErrors: { email: s.invite.memberExists } });
    assert.deepEqual(bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email: 'nope' })), { fieldErrors: { email: s.invite.emailBad } });
    assert.deepEqual(bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'owner', kind: 'link' })), { error: s.errors.invalid });
    assert.deepEqual(bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'link', access: 'selected', clientIds: ['not-ours'] })), { fieldErrors: { clients: s.pickClient } });

    const team = bodyOf<Team>(await call(admin).get('/api/team'));
    assert.deepEqual(team.members.map((m) => [m.email, m.role]), [[u.email, 'admin']]);
    assert.deepEqual(team.invites.map((i) => [i.email, i.role, i.clientIds]), [[email, 'accountant', [client1.id]], [null, 'viewer', []]]);
    assert.deepEqual(team.clients, [{ id: client1.id, name: 'Alfa', archived: false }]);
    assert.deepEqual([team.seatsOpen, team.mailEnabled, team.inviteDays], [true, false, 7]);
  });

  it('invites are refused for a non-admin (403) and a demo org (403 demo); a viewer\'s team page is empty', async () => {
    const u = await fx.user();
    const viewer = await sessionCookie(await fx.member(u, 'viewer'));
    const refused = await call(viewer).post('/api/team/invites').send({ role: 'viewer', kind: 'link' });
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'forbidden');
    assert.deepEqual(bodyOf<Team>(await call(viewer).get('/api/team')), { members: [], invites: [], clients: [], seatsOpen: false, mailEnabled: false, inviteDays: 7 });

    const demo = await fx.user({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    const demoRes = await call(await sessionCookie(demo)).post('/api/team/invites').send({ role: 'viewer', kind: 'link' });
    assert.equal(demoRes.status, 403);
    assert.equal(bodyOf(demoRes).error.code, 'demo');
  });

  it('a trial that has ended takes no new invites', async () => {
    const u = await fx.user({ plan: 'expired' });
    const res = await call(await sessionCookie(u)).post('/api/team/invites').send({ role: 'viewer', kind: 'link' });
    assert.deepEqual(bodyOf<Invite>(res), { error: ta.msg.gate.expired });
  });

  it('joining: the invite\'s view, the account created and signed in, a used link refused', async () => {
    const u = await fx.realEmail(await fx.user());
    const admin = await sessionCookie(u);
    const { url } = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'accountant', kind: 'link' }));
    const token = url!.split('/invite/')[1]!;
    const view = bodyOf<{ orgName: string; role: string; email: string | null }>(await call().get(`/api/invites/${token}`));
    assert.deepEqual([view.role, view.email], ['accountant', null]);
    assert.equal(bodyOf(await call().get('/api/invites/not-a-token')), null);

    const email = `joiner-${testIp()}@example.com`.toLowerCase();
    assert.deepEqual(bodyOf(await call().post(`/api/invites/${token}/join`).send({ email, password: 'short' })), { error: ta.msg.account.passwordShort });
    // A registered address gets the same generic answer as an unusable one (F20): nothing names the account.
    assert.deepEqual(bodyOf(await call().post(`/api/invites/${token}/join`).send({ email: u.email, password: 'long-enough-1' })), { error: ta.authX.invite.addressUnavailable });
    const joined = await call().post(`/api/invites/${token}/join`).send({ email, password: 'long-enough-1' });
    assert.deepEqual(bodyOf(joined), { redirect: '/catalogs' });
    const pair = sessionPair(joined)!;
    const me = bodyOf<{ email: string; role: string; orgId: string; verified: boolean }>(await call(pair).get('/api/auth/me'));
    assert.deepEqual([me.email, me.role, me.orgId, me.verified], [email, 'accountant', u.orgId, false]);
    assert.equal((await unsealPair(pair)).email, email);
    assert.deepEqual(bodyOf(await call().post(`/api/invites/${token}/join`).send({ email: `x${email}`, password: 'long-enough-1' })), { error: ta.msg.account.inviteBad });
  });

  it('an invite bound to an address leaves the account unconfirmed until the mailed code is entered (F2)', async () => {
    const u = await fx.user();
    const admin = await sessionCookie(u);
    const email = `bound-${testIp()}@example.com`.toLowerCase();
    const { url } = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email }));
    const token = url!.split('/invite/')[1]!;
    // Whoever holds the link (the inviting admin gets it too) can set a password, but proves nothing about the mailbox.
    const joined = await call().post(`/api/invites/${token}/join`).send({ email, password: 'long-enough-1' });
    assert.deepEqual(bodyOf(joined), { redirect: '/catalogs' });
    const pair = sessionPair(joined)!;
    const user = await db.user.findUniqueOrThrow({ where: { email }, include: { emailCodes: true } });
    assert.deepEqual([user.emailVerifiedAt, user.verifiedVia], [null, null]);
    assert.equal(user.emailCodes.filter((c) => !c.usedAt).length, 1, 'the code went to the address');
    const closed = await call(pair).get('/api/team');
    assert.equal(closed.status, 403);
    assert.equal(bodyOf(closed).error.code, 'unverified');

    // Only the code from the mailbox opens the account.
    assert.ok('error' in bodyOf<object>(await call(pair).post('/api/auth/verify-code').send({ code: '000000' })));
    const code = await issueCode(user.id);
    const confirmed = await call(pair).post('/api/auth/verify-code').send({ code });
    assert.deepEqual(bodyOf(confirmed), { redirect: '/dashboard' });
    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.ok(after.emailVerifiedAt);
    assert.equal(after.verifiedVia, 'code');
    assert.equal((await call(sessionPair(confirmed)).get('/api/team')).status, 200);
  });

  it('joining with an invite link is limited per client address (F20)', async () => {
    const u = await fx.user();
    const { url } = bodyOf<Invite>(await call(await sessionCookie(u)).post('/api/team/invites').send({ role: 'viewer', kind: 'link' }));
    const token = url!.split('/invite/')[1]!;
    const ip = testIp();
    for (let i = 0; i < 10; i++) {
      assert.deepEqual(bodyOf(await call(undefined, ip).post(`/api/invites/${token}/join`).send({ email: `x${i}@example.com`, password: 'short' })), { error: ta.msg.account.passwordShort });
    }
    assert.deepEqual(bodyOf(await call(undefined, ip).post(`/api/invites/${token}/join`).send({ email: 'y@example.com', password: 'long-enough-1' })), { error: ta.secX.tooMany(60) });
    assert.equal(await db.user.count({ where: { email: 'y@example.com' } }), 0);
  });

  it('warns the admin when the invited address already has an account elsewhere, without naming the org', async () => {
    const u = await fx.user({ plan: 'firm' });
    const admin = await sessionCookie(u);
    const elsewhere = await fx.realEmail(await fx.user());
    const warned = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email: elsewhere.email }));
    assert.equal(warned.existingAccount, s.invite.existingAccount);
    assert.ok(warned.url);
    const fresh = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email: `nobody-${testIp()}@example.com` }));
    assert.equal(fresh.existingAccount, undefined);
  });

  it('an existing account joins with the invite when its org is empty: moved in one go, old org closed, sessions renewed (D5)', async () => {
    const firm = await fx.user({ plan: 'firm' });
    const admin = await sessionCookie(firm);
    const alfa = await db.client.create({ data: { orgId: firm.orgId, name: 'Alfa' } });
    const { url } = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'accountant', kind: 'link', access: 'selected', clientIds: [alfa.id] }));
    const token = url!.split('/invite/')[1]!;

    const solo = await fx.user();
    const mine = await sessionCookie(solo);
    const elsewhere = await sessionCookie(solo);
    const check = bodyOf<{ ok: boolean; orgName?: string; role?: string }>(await call(mine).get(`/api/invites/${token}/account`));
    assert.deepEqual([check.ok, check.role], [true, 'accountant']);
    assert.equal((await call().get(`/api/invites/${token}/account`)).status, 401, 'signed-in users only');

    const moved = await call(mine).post(`/api/invites/${token}/account`);
    assert.deepEqual(bodyOf(moved), { redirect: '/dashboard' });
    const pair = sessionPair(moved)!;
    const me = bodyOf<{ orgId: string; role: string; clientIds: string[] | null }>(await call(pair).get('/api/auth/me'));
    assert.deepEqual([me.orgId, me.role, me.clientIds], [firm.orgId, 'accountant', [alfa.id]]);
    assert.equal((await unsealPair(pair)).orgId, firm.orgId);
    assert.equal((await call(elsewhere).get('/api/auth/me')).status, 401, 'other sessions end');
    assert.equal((await call(mine).get('/api/auth/me')).status, 401, 'the old cookie too');

    const old = await db.organization.findUniqueOrThrow({ where: { id: solo.orgId } });
    assert.ok(old.deletedAt, 'the empty org is closed, not deleted');
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: solo.orgId, action: 'account.deletion_requested' } }));
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: firm.orgId, action: 'team.joined', actorId: solo.userId } }));
    assert.ok((await db.invite.findFirstOrThrow({ where: { orgId: firm.orgId } })).usedAt);
    const team = bodyOf<Team>(await call(admin).get('/api/team'));
    assert.deepEqual(team.members.map((m) => m.email).sort(), [firm.email, solo.email].sort());
    assert.equal(bodyOf<{ ok: boolean }>(await call(pair).get(`/api/invites/${token}/account`)).ok, false, 'the invite is spent');
  });

  it('an existing account with other users or catalogues is refused, with the reason and the inviting admin\'s address (D5)', async () => {
    const firm = await fx.realEmail(await fx.user({ plan: 'firm' }));
    const admin = await sessionCookie(firm);
    const link = async (body: object): Promise<string> => bodyOf<Invite>(await call(admin).post('/api/team/invites').send(body)).url!.split('/invite/')[1]!;
    const refusal = (error: string) => ({ ok: false, error, adminEmail: firm.email });

    const busy = await fx.user();
    await fx.member(busy, 'viewer');
    const busyCookie = await sessionCookie(busy);
    const token = await link({ role: 'viewer', kind: 'link' });
    assert.deepEqual(bodyOf(await call(busyCookie).get(`/api/invites/${token}/account`)), refusal(ta.authX.invite.refused.members));
    assert.deepEqual(bodyOf(await call(busyCookie).post(`/api/invites/${token}/account`)), { error: ta.authX.invite.refused.members, adminEmail: firm.email });

    const withCatalog = await fx.user();
    await db.catalog.create({ data: { orgId: withCatalog.orgId, filename: 'bor.xlsx', rowCount: 0, status: 'ready', headers: [], columnMap: {} } });
    assert.deepEqual(bodyOf(await call(await sessionCookie(withCatalog)).post(`/api/invites/${token}/account`)), { error: ta.authX.invite.refused.catalogs, adminEmail: firm.email });

    const bound = await link({ role: 'viewer', kind: 'email', email: `someone-${testIp()}@example.com` });
    const solo = await fx.user();
    assert.deepEqual(bodyOf(await call(await sessionCookie(solo)).get(`/api/invites/${bound}/account`)), refusal(ta.msg.account.inviteWrongEmail));
    assert.deepEqual(bodyOf(await call(admin).get(`/api/invites/${token}/account`)), refusal(ta.authX.invite.refused.sameOrg));

    // Nothing moved, nothing closed, the invite is still open.
    for (const who of [busy, withCatalog, solo]) {
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: who.userId } })).orgId, who.orgId);
      assert.equal((await db.organization.findUniqueOrThrow({ where: { id: who.orgId } })).deletedAt, null);
    }
    assert.equal(await db.invite.count({ where: { orgId: firm.orgId, usedAt: { not: null } } }), 0);
  });

  it('members: change role and access, the last admin stays, remove (not yourself); revoke and resend invites', async () => {
    const u = await fx.user({ plan: 'firm' });
    const admin = await sessionCookie(u);
    const other = await fx.member(u, 'accountant');
    const alfa = await db.client.create({ data: { orgId: u.orgId, name: 'Alfa' } });
    const path = (id: string) => `/api/team/members/${id}`;

    assert.deepEqual(bodyOf(await call(admin).patch(path(other.userId)).send({ role: 'viewer', access: 'selected', clientIds: [alfa.id] })), { ok: true });
    assert.deepEqual(await db.clientAssignment.findMany({ where: { userId: other.userId }, select: { clientId: true } }), [{ clientId: alfa.id }]);
    assert.deepEqual(bodyOf(await call(admin).patch(path(other.userId)).send({ role: 'viewer', access: 'selected', clientIds: [] })), { ok: false, error: s.errors.no_clients });
    assert.deepEqual(bodyOf(await call(admin).patch(path(u.userId)).send({ role: 'viewer', access: 'all', clientIds: [] })), { ok: false, error: s.errors.last_admin });
    assert.deepEqual(bodyOf(await call(admin).patch(path('nobody')).send({ role: 'viewer', access: 'all', clientIds: [] })), { ok: false, error: s.errors.not_found });
    assert.equal((await call(admin).patch(path(other.userId)).send({ role: 'owner', access: 'all', clientIds: [] })).status, 400);

    assert.deepEqual(bodyOf(await call(admin).delete(path(u.userId))), { ok: false, error: s.errors.self });
    const otherCookie = await sessionCookie(other);
    assert.deepEqual(bodyOf(await call(admin).delete(path(other.userId))), { ok: true });
    assert.equal((await call(otherCookie).get('/api/auth/me')).status, 401);
    assert.deepEqual(bodyOf(await call(admin).delete(path(other.userId))), { ok: false, error: s.errors.not_found });

    const email = `pending-${testIp()}@example.com`.toLowerCase();
    await call(admin).post('/api/team/invites').send({ role: 'viewer', kind: 'email', email });
    const invite = await db.invite.findFirstOrThrow({ where: { orgId: u.orgId, email } });
    // Without mail the letter cannot go out again, and the old invite stays.
    assert.deepEqual(bodyOf(await call(admin).post(`/api/team/invites/${invite.id}/resend`)), { ok: false, error: s.pending.resendFailed });
    assert.deepEqual(bodyOf(await call(admin).delete(`/api/team/invites/${invite.id}`)), { ok: true });
    assert.deepEqual(bodyOf(await call(admin).delete(`/api/team/invites/${invite.id}`)), { ok: false, error: s.pending.notFound });
    assert.deepEqual(bodyOf(await call(admin).post(`/api/team/invites/${invite.id}/resend`)), { ok: false, error: s.pending.notFound });
  });
});

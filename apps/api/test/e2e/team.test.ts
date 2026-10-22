// endpoints.team against the development database: the team page's data, invites, joining with
// one (which signs the new member in), member changes and removal.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { db } from '@tasnivo/db';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, startApp, testIp } from '../helpers';
import { client, Fixtures, quietEnv, sessionCookie, sessionPair, unsealPair } from '../session-helpers';

const skip = await dbSkipReason();
const { ta } = i18nFor('uz');
const s = ta.setX.team;

type Invite = { url?: string; email?: string | null; emailed?: boolean; error?: string; fieldErrors?: { email?: string; clients?: string } };
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
    const u = await fx.user();
    const admin = await sessionCookie(u);
    const { url } = bodyOf<Invite>(await call(admin).post('/api/team/invites').send({ role: 'accountant', kind: 'link' }));
    const token = url!.split('/invite/')[1]!;
    const view = bodyOf<{ orgName: string; role: string; email: string | null }>(await call().get(`/api/invites/${token}`));
    assert.deepEqual([view.role, view.email], ['accountant', null]);
    assert.equal(bodyOf(await call().get('/api/invites/not-a-token')), null);

    const email = `joiner-${testIp()}@example.com`.toLowerCase();
    assert.deepEqual(bodyOf(await call().post(`/api/invites/${token}/join`).send({ email, password: 'short' })), { error: ta.msg.account.passwordShort });
    const joined = await call().post(`/api/invites/${token}/join`).send({ email, password: 'long-enough-1' });
    assert.deepEqual(bodyOf(joined), { redirect: '/catalogs' });
    const pair = sessionPair(joined)!;
    const me = bodyOf<{ email: string; role: string; orgId: string }>(await call(pair).get('/api/auth/me'));
    assert.deepEqual([me.email, me.role, me.orgId], [email, 'accountant', u.orgId]);
    assert.equal((await unsealPair(pair)).email, email);
    assert.deepEqual(bodyOf(await call().post(`/api/invites/${token}/join`).send({ email: `x${email}`, password: 'long-enough-1' })), { error: ta.msg.account.inviteBad });
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

// The clients module against the development database: list and page reads in the contract's
// shape, create/rename/archive/restore/delete/accountants with the actions' answers, the active
// client in the session cookie, and refusals by role, scope and org.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { addClient, addMember, CSRF, fits, sessionCookie, sessionSet, type Member } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.clients;
const { t, ta } = i18nFor('uz');

describe('clients module (database)', { skip }, () => {
  let app: INestApplication;
  let admin: TestUser;
  let adminCookie = '';
  let other: TestUser;
  const orgs: string[] = [];
  const http = () => request(serverOf(app));

  before(async () => {
    app = await startApp();
    admin = await makeUser();
    other = await makeUser();
    orgs.push(admin.orgId, other.orgId);
    // A paying firm (no plan limits in the way); `other` stays a customer whose trial is over.
    await db.organization.update({ where: { id: admin.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    adminCookie = await sessionCookie(admin);
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('GET /api/clients needs a session and answers the contract\'s list', async () => {
    assert.equal((await http().get('/api/clients')).status, 401);
    const mine = await addClient(admin.orgId, 'Alfa savdo');
    await addClient(other.orgId, 'Begona');
    const res = await http().get('/api/clients?filter=all&sort=name').set('Cookie', adminCookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const list = fits(e.list.response, res.body);
    assert.ok(list.rows.some((r) => r.id === mine.id && r.name === 'Alfa savdo'));
    assert.ok(list.rows.every((r) => r.name !== 'Begona'));
    assert.equal(list.pageSize, 50);
    assert.equal(list.staleDays, 30);
    assert.equal(fits(e.list.response, (await http().get('/api/clients?days=90').set('Cookie', adminCookie)).body).staleDays, 90);
    assert.equal((await http().get('/api/clients?filter=nonsense').set('Cookie', adminCookie)).status, 400);
  });

  it('POST /api/clients creates a client and makes it the active one (session cookie)', async () => {
    const res = await http().post('/api/clients').set(CSRF).set('Cookie', adminCookie).send({ name: '  Yangi mijoz ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const body = fits(e.create.response, res.body);
    assert.ok(body.ok, JSON.stringify(body));
    const client = await db.client.findUniqueOrThrow({ where: { id: body.clientId } });
    assert.equal(client.orgId, admin.orgId);
    assert.equal(client.name, 'Yangi mijoz');
    assert.equal((await sessionSet(res))?.clientId, body.clientId);
    // The CSRF header is required, and a bad name is the action's message, not a 400.
    assert.equal((await http().post('/api/clients').set('Cookie', adminCookie).send({ name: 'x' })).status, 403);
    const bad = await http().post('/api/clients').set(CSRF).set('Cookie', adminCookie).send({ name: 42 });
    assert.deepEqual(bad.body, { ok: false, error: t.clientsBadName });
    // The plan gate: an org whose trial is over gets the gate's message.
    const gated = await http().post('/api/clients').set(CSRF).set('Cookie', await sessionCookie(other)).send({ name: 'Gated' });
    assert.deepEqual(gated.body, { ok: false, error: ta.msg.gate.expired });
  });

  it('a viewer may not create (403) and a demo org may not either', async () => {
    const viewer = await addMember(admin.orgId, 'viewer');
    const res = await http().post('/api/clients').set(CSRF).set('Cookie', await sessionCookie(viewer)).send({ name: 'Nope' });
    assert.equal(res.status, 403);
    assert.equal(bodyOf(res).error.code, 'forbidden');

    const demo = await makeUser({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    orgs.push(demo.orgId);
    const demoRes = await http().post('/api/clients').set(CSRF).set('Cookie', await sessionCookie(demo, { demo: true })).send({ name: 'Nope' });
    assert.equal(demoRes.status, 403);
    assert.equal(bodyOf(demoRes).error.code, 'demo');
  });

  it('PUT /api/clients/active switches to a visible client only', async () => {
    const target = await addClient(admin.orgId);
    const res = await http().put('/api/clients/active').set(CSRF).set('Cookie', adminCookie).send({ clientId: target.id });
    assert.deepEqual(res.body, { ok: true, client: { id: target.id, name: target.name } });
    assert.equal((await sessionSet(res))?.clientId, target.id);

    const archived = await addClient(admin.orgId, undefined, { archivedAt: new Date() });
    const foreign = await addClient(other.orgId);
    for (const clientId of [archived.id, foreign.id]) {
      const refused = await http().put('/api/clients/active').set(CSRF).set('Cookie', adminCookie).send({ clientId });
      assert.deepEqual(refused.body, { ok: false, error: 'not_found' });
      assert.equal(await sessionSet(refused), null);
    }
    assert.deepEqual((await http().put('/api/clients/active').set(CSRF).set('Cookie', adminCookie).send({})).body, { ok: false, error: 'invalid' });
  });

  it('GET /api/clients/{id}: the page data for a visible client, 404 for another org\'s or out of scope', async () => {
    const client = await addClient(admin.orgId);
    const res = await http().get(`/api/clients/${client.id}`).set('Cookie', adminCookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const page = fits(e.get.response, res.body);
    assert.equal(page.client.id, client.id);
    assert.ok(Array.isArray(page.accountants), 'admins see the accountants');
    assert.ok(page.dependants, 'admins outside a demo see the dependants');

    const foreign = await addClient(other.orgId);
    assert.equal((await http().get(`/api/clients/${foreign.id}`).set('Cookie', adminCookie)).status, 404);

    const scoped: Member = await addMember(admin.orgId, 'accountant', [client.id]);
    const scopedCookie = await sessionCookie(scoped);
    const elsewhere = await addClient(admin.orgId);
    assert.equal((await http().get(`/api/clients/${elsewhere.id}`).set('Cookie', scopedCookie)).status, 404);
    const own = fits(e.get.response, (await http().get(`/api/clients/${client.id}`).set('Cookie', scopedCookie)).body);
    assert.equal(own.accountants, null, 'accountants are for admins only');
    assert.equal(own.dependants, null);
  });

  it('rename, archive (clears the active client), restore and delete with the typed name', async () => {
    const client = await addClient(admin.orgId, 'Eski nom');
    const withActive = await sessionCookie(admin, { clientId: client.id });
    const renamed = await http().patch(`/api/clients/${client.id}`).set(CSRF).set('Cookie', withActive).send({ name: 'Yangi nom' });
    assert.deepEqual(renamed.body, { ok: true });
    assert.equal((await db.client.findUniqueOrThrow({ where: { id: client.id } })).name, 'Yangi nom');

    const archived = await http().post(`/api/clients/${client.id}/archive`).set(CSRF).set('Cookie', withActive);
    assert.equal(archived.status, 200);
    assert.deepEqual(fits(e.archive.response, archived.body), { ok: true, stranded: [] });
    const session = await sessionSet(archived);
    assert.ok(session && session.clientId === undefined, 'the archived client is no longer the active one');

    assert.deepEqual((await http().post(`/api/clients/${client.id}/restore`).set(CSRF).set('Cookie', adminCookie)).body, { ok: true });

    const mismatch = await http().post(`/api/clients/${client.id}/delete`).set(CSRF).set('Cookie', adminCookie).send({ confirmName: 'boshqa' });
    assert.deepEqual(mismatch.body, { ok: false, error: ta.firmX.errors['name mismatch'] });
    const deleted = await http().post(`/api/clients/${client.id}/delete`).set(CSRF).set('Cookie', adminCookie).send({ confirmName: 'Yangi nom' });
    assert.deepEqual(deleted.body, { ok: true });
    assert.equal(await db.client.count({ where: { id: client.id } }), 0);
  });

  it('lifecycle routes are for admins: an accountant gets 403; another org\'s client is the action\'s refusal', async () => {
    const client = await addClient(admin.orgId);
    const accountant = await addMember(admin.orgId, 'accountant');
    const res = await http().patch(`/api/clients/${client.id}`).set(CSRF).set('Cookie', await sessionCookie(accountant)).send({ name: 'X' });
    assert.equal(res.status, 403);
    const foreign = await addClient(other.orgId, 'Begona 2');
    const refused = await http().patch(`/api/clients/${foreign.id}`).set(CSRF).set('Cookie', adminCookie).send({ name: 'Hijack' });
    assert.deepEqual(refused.body, { ok: false, error: ta.firmX.errors['not found'] });
    assert.equal((await db.client.findUniqueOrThrow({ where: { id: foreign.id } })).name, 'Begona 2');
  });

  it('accountants: listed for the editor and assigned with PUT', async () => {
    const client = await addClient(admin.orgId);
    // Only an accountant already limited to some client can be assigned here (an unrestricted one sees every client).
    const accountant = await addMember(admin.orgId, 'accountant', [(await addClient(admin.orgId)).id]);
    const listed = fits(e.accountants.response, (await http().get(`/api/clients/${client.id}/accountants`).set('Cookie', adminCookie)).body);
    assert.ok(listed.some((a) => a.id === accountant.userId && !a.assigned));
    const set = await http().put(`/api/clients/${client.id}/accountants`).set(CSRF).set('Cookie', adminCookie).send({ userIds: [accountant.userId] });
    assert.deepEqual(set.body, { ok: true });
    assert.equal(await db.clientAssignment.count({ where: { userId: accountant.userId, clientId: client.id } }), 1);
    const foreign = await addClient(other.orgId);
    assert.equal((await http().get(`/api/clients/${foreign.id}/accountants`).set('Cookie', adminCookie)).status, 404);
  });
});

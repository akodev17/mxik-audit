// endpoints.imports through the real app against the development database: purchase lists and
// cheque lists from upload to a finished check (in-process), the list screens' data, the
// templates, and the refusals.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { makeClient, makePerson } from '@tasnivo/domain/firm-test-fixtures';
import { setJobs } from '@tasnivo/domain/jobs/dispatcher';
import { InlineDispatcher } from '@tasnivo/domain/jobs/inline';
import { liveCodes } from '@tasnivo/domain/test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { binary, eventually, matches, sessionCookie, xlsx } from '../upload-fixtures';

const skip = await dbSkipReason();
const im = endpoints.imports;
const { t, ta } = i18nFor('uz');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Uploaded = { ok: true; preview: { listId: string; map: Record<string, number>; totalRows: number } } | { ok: false; error: string };

describe('imports (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let owner: TestUser;
  let cookie = '';
  let clientId = '';
  let codes: string[] = [];

  const http = () => request(serverOf(app));
  const send = (method: 'post' | 'put' | 'delete', path: string, who = cookie) => http()[method](path).set('Cookie', who).set('X-Requested-With', 'tasnivo');

  before(async () => {
    setJobs(new InlineDispatcher());
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    clientId = await makeClient(owner.orgId, 'Import mijoz');
    cookie = await sessionCookie(owner);
    codes = await liveCodes(2);
  });
  after(async () => {
    setJobs(null);
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('purchases: upload, list, apply the columns, remove', async () => {
    const file = await xlsx([['Tovar nomi', 'MXIK', 'Birlik'], ['Un', codes[0] ?? '', 'kg'], ['Shakar', codes[1] ?? '', 'kg']]);
    const res = await send('post', `/api/clients/${clientId}/purchases`).attach('file', file, 'kirim.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(im.uploadPurchases.response, res.body, 'uploadPurchases');
    const up = bodyOf<Uploaded>(res);
    assert.ok(up.ok, JSON.stringify(up));
    assert.equal(up.preview.totalRows, 2);

    const page = await http().get(`/api/clients/${clientId}/purchases`).set('Cookie', cookie);
    assert.equal(page.status, 200);
    matches(im.purchases.response, page.body, 'purchases');
    const lists = bodyOf<{ lists: { id: string; status: string; sample: string[][] }[] }>(page).lists;
    assert.equal(lists[0]?.id, up.preview.listId);
    assert.equal(lists[0]?.sample.length, 2);

    const applied = await send('post', `/api/purchases/${up.preview.listId}/apply`).send({ map: up.preview.map });
    assert.deepEqual(applied.body, { ok: true, codes: 2 });
    const bad = await send('post', `/api/purchases/${up.preview.listId}/apply`).send({ map: { mxik: -5 } });
    assert.deepEqual(bad.body, { ok: false, error: ta.importX.errors.badMapping });

    assert.deepEqual((await send('delete', `/api/purchases/${up.preview.listId}`)).body, { ok: true });
    assert.deepEqual((await send('delete', `/api/purchases/${up.preview.listId}`)).body, { ok: false, error: ta.importX.lists.deleteFailed });
  });

  it('activity type: set, and refused for an unknown value', async () => {
    assert.deepEqual((await send('put', `/api/clients/${clientId}/activity`).send({ activity: 'savdo' })).body, { ok: true });
    assert.equal((await db.client.findUnique({ where: { id: clientId }, select: { activity: true } }))?.activity, 'savdo');
    assert.deepEqual((await send('put', `/api/clients/${clientId}/activity`).send({ activity: 'nope' })).body, { ok: false });
  });

  it('cheques: upload, apply starts the check, it finishes, the report, restart refused, remove', async () => {
    const file = await xlsx([['Mahsulot', 'MXIK', 'Birlik', 'Miqdor', 'Summa', 'Sana'], ['Un', codes[0] ?? '', 'kg', '2', '20000', '2026-10-01'], ['Shakar', '', 'kg', '1', '15000', '2026-10-02']]);
    const res = await send('post', `/api/clients/${clientId}/docs`).field('kind', 'cheques').attach('file', file, 'cheklar.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(im.uploadDoc.response, res.body, 'uploadDoc');
    const up = bodyOf<Uploaded>(res);
    assert.ok(up.ok, JSON.stringify(up));
    const listId = up.preview.listId;

    const docs = await http().get(`/api/clients/${clientId}/docs`).query({ kind: 'cheques' }).set('Cookie', cookie);
    assert.equal(docs.status, 200);
    matches(im.docs.response, docs.body, 'docs');
    const first = bodyOf<{ lists: { id: string; sample: string[][] }[] }>(docs).lists[0];
    assert.equal(first?.id, listId);
    assert.equal(first?.sample.length, 2, 'an unmapped list carries its sample to resume the mapping');

    assert.deepEqual((await send('post', `/api/docs/${listId}/apply`).send({ map: up.preview.map })).body, { ok: true });
    const report = await eventually(async () => {
      const r = await http().get(`/api/docs/${listId}`).set('Cookie', cookie);
      assert.equal(r.status, 200);
      matches(im.doc.response, r.body, 'doc');
      const body = bodyOf<{ list: { status: string }; groups: { issues: string[] }[] }>(r);
      assert.notEqual(body.list.status, 'failed');
      return body.list.status === 'ready' ? body : undefined;
    }, 120_000, 'the cheque check');
    assert.ok(report.groups.length >= 1);
    const missing = await http().get(`/api/docs/${listId}`).query({ issue: 'MISSING_CODE' }).set('Cookie', cookie);
    assert.ok(bodyOf<{ groups: { issues: string[] }[] }>(missing).groups.every((g) => g.issues.includes('MISSING_CODE')));

    assert.deepEqual((await send('post', `/api/docs/${listId}/restart`)).body, { ok: false, error: ta.importX.docs.restartFailed }, 'a finished check is not restarted');
    assert.deepEqual((await send('delete', `/api/docs/${listId}`)).body, { ok: true });
    assert.equal((await http().get(`/api/docs/${listId}`).set('Cookie', cookie)).status, 404);
  });

  it('templates in the requester\'s language', async () => {
    const get = (path: string, locale = 'uz') => http().get(path).set('Cookie', `${cookie}; mxik_locale=${locale}`).buffer(true).parse(binary);
    for (const [path, file] of [
      ['/api/purchase-template', ta.importX.templates.purchases.file],
      ['/api/doc-template', ta.importX.templates.cheques.file],
      ['/api/doc-template?kind=sales', ta.importX.templates.sales.file],
    ] as const) {
      const res = await get(path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers['content-type'], XLSX);
      assert.ok(String(res.headers['content-disposition']).startsWith('attachment; '), path);
      assert.ok(String(res.headers['content-disposition']).includes(encodeURIComponent(file).replace(/'/g, '%27')) || String(res.headers['content-disposition']).includes(file), `${path}: ${String(res.headers['content-disposition'])}`);
      assert.equal((res.body as Buffer).subarray(0, 2).toString(), 'PK');
    }
    const ru = await get('/api/purchase-template', 'ru');
    assert.notEqual(ru.headers['content-disposition'], (await get('/api/purchase-template')).headers['content-disposition']);
    assert.equal((await http().get('/api/purchase-template')).status, 401);
  });

  it('refusals: another org 404, a viewer 403, a demo org and an archived client the action\'s message, wrong kind', async () => {
    const file = await xlsx([['Nomi', 'MXIK'], ['Un', codes[0] ?? '']]);
    const stranger = await makeUser();
    orgs.push(stranger.orgId);
    const other = await sessionCookie(stranger);
    assert.equal((await http().get(`/api/clients/${clientId}/purchases`).set('Cookie', other)).status, 404);
    assert.equal((await http().get(`/api/clients/${clientId}/docs`).set('Cookie', other)).status, 404);
    await db.organization.update({ where: { id: stranger.orgId }, data: { subscriptionUntil: new Date(Date.now() + 86_400_000) } });
    assert.deepEqual((await send('post', `/api/clients/${clientId}/purchases`, other).attach('file', file, 'k.xlsx')).body, { ok: false, error: ta.importX.errors.client });

    const viewer = await sessionCookie(await makePerson(owner.orgId, 'viewer'));
    assert.equal((await send('post', `/api/clients/${clientId}/purchases`, viewer).attach('file', file, 'k.xlsx')).status, 403);
    assert.equal((await http().get(`/api/clients/${clientId}/purchases`).set('Cookie', viewer)).status, 200);

    const archived = await makeClient(owner.orgId, 'Arxiv', { archived: true });
    assert.deepEqual((await send('post', `/api/clients/${archived}/purchases`).attach('file', file, 'k.xlsx')).body, { ok: false, error: ta.importX.errors.archived });
    assert.deepEqual((await send('post', `/api/clients/${clientId}/docs`).field('kind', 'boshqa').attach('file', file, 'k.xlsx')).body, { ok: false, error: ta.importX.errors.client });
    assert.deepEqual((await send('post', `/api/clients/${clientId}/docs`).field('kind', 'sales')).body, { ok: false, error: ta.importX.errors.none });
    assert.deepEqual((await send('post', `/api/clients/${clientId}/purchases`).attach('file', Buffer.alloc(20 * 1024 * 1024 + 1, 1), 'katta.xlsx')).body, { ok: false, error: ta.importX.errors.tooBig });

    const demo = await makeUser({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    orgs.push(demo.orgId);
    const demoCookie = await sessionCookie(demo, { demo: true });
    const demoClient = await makeClient(demo.orgId, 'Demo mijoz');
    assert.deepEqual((await send('post', `/api/clients/${demoClient}/purchases`, demoCookie).attach('file', file, 'k.xlsx')).body, { ok: false, error: t.demoUploadDisabled });
    assert.deepEqual((await send('post', `/api/clients/${demoClient}/docs`, demoCookie).field('kind', 'cheques').attach('file', file, 'k.xlsx')).body, { ok: false, error: t.demoUploadDisabled });
    assert.deepEqual((await send('put', `/api/clients/${demoClient}/activity`, demoCookie).send({ activity: 'savdo' })).body, { ok: false });

    const expired = await makeUser();
    orgs.push(expired.orgId);
    const expiredClient = await makeClient(expired.orgId, 'Muddati o‘tgan');
    assert.deepEqual((await send('post', `/api/clients/${expiredClient}/purchases`, await sessionCookie(expired)).attach('file', file, 'k.xlsx')).body, { ok: false, error: ta.msg.gate.expired });
  });
});

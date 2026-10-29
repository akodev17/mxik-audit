// endpoints.products through the real app against the development database, with a fake Tasnif
// client (never the network): the product-list import (preview → commit → background check →
// decide → save) under the plan gate (D4: an ended plan refuses, rows never count against
// rowsPerMonth), client scope and roles; "Confirm MXIK" teaching the firm dictionary, where a scoped
// member's confirmation is kept but not trusted (S4); and who may edit what (there is no product
// delete endpoint: confirm and the import decisions are the edits).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { makeClient } from '@tasnivo/domain/firm-test-fixtures';
import { usageOf } from '@tasnivo/domain/plan';
import { useTasnifClient } from '@tasnivo/domain/products/tasnif-client';
import { FakeTasnifClient } from '@tasnivo/domain/products/test-fixtures';
import { dbSkipReason, dropOrgs, liveCodes } from '@tasnivo/domain/test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, serverOf, startApp } from '../helpers';
import { eventually, matches, xlsx } from '../upload-fixtures';
import { member, orgWithAdmin, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();
const p = endpoints.products;
const { t, ta } = i18nFor('uz');
const MAPPING = JSON.stringify({ name: 0, onecRef: -1, article: -1, mxik: 1, packageCode: -1, unit: 2, barcode: -1 });

type BatchView = { batch: { id: string; status: string; clientId: string | null }; records: { id: string; status: string; payload: { name: string } }[]; total: number };

describe('products (database, fake Tasnif)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let admin: Member; let accountant: Member; let scoped: Member; let viewer: Member;
  let expired: Member; let demo: Member;
  let clientA = ''; let clientB = '';
  let code = '';
  let otherCode = '';
  let file = 0;

  const http = () => request(serverOf(app));
  const get = (path: string, who: Member) => http().get(path).set('Cookie', who.cookie);
  const send = (method: 'post' | 'put', path: string, who: Member) => http()[method](path).set('Cookie', who.cookie).set('X-Requested-With', 'tasnivo');
  /** A two-row product list; each call a different file, so a commit is never answered as a duplicate. */
  const sheet = async () => xlsx([['Nomi', 'MXIK', 'Birlik'], [`Shakar oq ${++file}`, code, 'kg'], [`Guruch lazer ${file}`, '', 'kg']]);
  const preview = async (who: Member, clientId: string) =>
    send('post', '/api/products/import/preview', who).field('clientId', clientId).attach('file', await sheet(), 'tovarlar.xlsx');
  const commit = async (who: Member, clientId: string) =>
    send('post', '/api/products/import', who).field('clientId', clientId).field('mapping', MAPPING).attach('file', await sheet(), 'tovarlar.xlsx');
  const checked = (batchId: string, who: Member) => eventually(async () => {
    const res = await get(`/api/products/import/${batchId}`, who);
    const view = bodyOf<BatchView>(res);
    return res.status === 200 && view.batch.status !== 'parsed' ? view : undefined;
  }, 120_000, 'the product check');
  const product = async (clientId: string, name: string) =>
    (await db.product.create({ data: { orgId: admin.orgId, clientId, name, normalizedName: name.toLowerCase(), source: 'manual', unit: 'kg' }, select: { id: true } })).id;
  const entryFor = (name: string) => db.firmMapping.findFirst({
    where: { orgId: admin.orgId, kind: 'name', key: dictionaryKeys({ rawName: name, unit: 'kg', barcode: null }).name ?? '' },
    select: { code: true, confirmations: true, needsReconfirm: true },
  });

  before(async () => {
    useTasnifClient(new FakeTasnifClient());
    app = await startApp();
    admin = await orgWithAdmin(orgs);
    await db.organization.update({ where: { id: admin.orgId }, data: { trialEndsAt: new Date(Date.now() + 7 * 86_400_000) } });
    clientA = await makeClient(admin.orgId, 'Tovar mijoz A');
    clientB = await makeClient(admin.orgId, 'Tovar mijoz B');
    accountant = await member(admin.orgId, 'accountant');
    scoped = await member(admin.orgId, 'accountant', [clientA]);
    viewer = await member(admin.orgId, 'viewer');
    // A customer org with neither trial nor subscription: its plan has ended.
    expired = await orgWithAdmin(orgs);
    demo = await orgWithAdmin(orgs, 'demo');
    [code, otherCode] = await liveCodes(2) as [string, string];
  });
  after(async () => {
    useTasnifClient(null);
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('preview → commit → check → decide → save, and the rows never count against rowsPerMonth (D4)', async () => {
    const pre = await preview(admin, clientA);
    assert.equal(pre.status, 200, JSON.stringify(pre.body));
    matches(p.importPreview.response, pre.body, 'preview');
    assert.equal(bodyOf<{ ok: true; rowCount: number }>(pre).rowCount, 2);

    const res = await commit(admin, clientA);
    matches(p.importCommit.response, res.body, 'commit');
    const { batchId } = bodyOf<{ ok: true; batchId: string; duplicate: boolean }>(res);
    assert.ok(batchId, JSON.stringify(res.body));
    const view = await checked(batchId, admin);
    assert.equal(view.batch.status, 'review');
    assert.equal(view.batch.clientId, clientA);
    assert.equal(view.total, 2);

    const second = view.records.find((r) => r.payload.name.startsWith('Guruch'));
    assert.ok(second);
    const decided = await send('put', `/api/products/import/${batchId}/records/${second.id}`, admin).send({ action: 'set_code', code: otherCode });
    assert.equal(bodyOf<{ ok: boolean }>(decided).ok, true, JSON.stringify(decided.body));
    const applied = await send('post', `/api/products/import/${batchId}/apply`, admin).send();
    matches(p.importApply.response, applied.body, 'apply');
    assert.equal(bodyOf<{ ok: true; created: number }>(applied).created, 2);
    assert.equal(await db.product.count({ where: { orgId: admin.orgId, clientId: clientA, source: 'catalog_import' } }), 2);
    assert.equal((await usageOf(admin.orgId)).rowsPerMonth, 0);
  });

  it('an ended plan refuses the preview and the commit and stores nothing; a demo org is refused by the guard', async () => {
    const expiredClient = await makeClient(expired.orgId, 'Tugagan mijoz');
    for (const res of [await preview(expired, expiredClient), await commit(expired, expiredClient)]) {
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { ok: false, error: ta.msg.gate.expired });
    }
    assert.equal(await db.importBatch.count({ where: { orgId: expired.orgId } }), 0);
    for (const res of [await preview(demo, 'own'), await commit(demo, 'own')]) {
      assert.equal(res.status, 403);
      assert.equal(bodyOf(res).error.code, 'demo');
    }
  });

  it('client scope: a scoped accountant imports for their client only, and never sees another client\'s batch', async () => {
    for (const res of [await preview(scoped, clientB), await commit(scoped, clientB), await preview(scoped, 'own')]) {
      assert.deepEqual(res.body, { ok: false, error: ta.importX.errors.client });
    }
    const own = await commit(scoped, clientA);
    const { batchId } = bodyOf<{ batchId: string }>(own);
    assert.ok(batchId, JSON.stringify(own.body));
    await checked(batchId, scoped);

    // The admin's batch for client B: 404 to the scoped accountant, in the list nothing of client B.
    const theirs = bodyOf<{ batchId: string }>(await commit(admin, clientB)).batchId;
    await checked(theirs, admin);
    assert.equal((await get(`/api/products/import/${theirs}`, scoped)).status, 404);
    const record = (await db.importRecord.findFirstOrThrow({ where: { batchId: theirs }, select: { id: true } })).id;
    assert.deepEqual((await send('put', `/api/products/import/${theirs}/records/${record}`, scoped).send({ action: 'skip' })).body, { ok: false, error: t.errorGeneric });
    assert.deepEqual((await send('post', `/api/products/import/${theirs}/apply`, scoped).send()).body, { ok: false, error: t.errorGeneric });
    assert.equal(await db.importRecord.count({ where: { batchId: theirs, status: 'skipped' } }), 0);
    assert.equal(await db.product.count({ where: { orgId: admin.orgId, clientId: clientB } }), 0);

    const productB = await product(clientB, 'Tuz yodlangan B');
    const list = await get(`/api/products?client=${clientB}`, scoped);
    assert.equal(list.status, 200);
    assert.ok(!JSON.stringify(list.body).includes(productB));
    assert.equal((await get(`/api/products/${productB}`, scoped)).status, 404);
    // The unscoped accountant reaches both clients, and the org-wide list ("own").
    assert.equal((await get(`/api/products/${productB}`, accountant)).status, 200);
    assert.equal(bodyOf<{ ok: boolean }>(await preview(accountant, 'own')).ok, true);
  });

  it('a viewer reads the catalogue but every product write is refused by the guard', async () => {
    const id = await product(clientA, 'Un birinchi navli V');
    assert.equal((await get('/api/products', viewer)).status, 200);
    assert.equal((await get(`/api/products/${id}`, viewer)).status, 200);
    const batchId = (await db.importBatch.findFirstOrThrow({ where: { orgId: admin.orgId, kind: 'product_catalog' }, select: { id: true } })).id;
    const writes = [
      await preview(viewer, clientA), await commit(viewer, clientA),
      await send('post', `/api/products/${id}/confirm`, viewer).send({ code }),
      await send('post', '/api/products/check', viewer).send({ ids: [id] }),
      await send('post', '/api/products/export', viewer).send({}),
      await send('put', `/api/products/import/${batchId}/records/x`, viewer).send({ action: 'skip' }),
      await send('post', `/api/products/import/${batchId}/apply`, viewer).send(),
      await send('post', `/api/products/import/${batchId}/export`, viewer).send(),
    ];
    for (const res of writes) {
      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.equal(bodyOf(res).error.code, 'forbidden');
    }
    assert.equal((await db.product.findUniqueOrThrow({ where: { id }, select: { mxik: true } })).mxik, null);
  });

  it('"Confirm MXIK" teaches the dictionary: an unscoped member confirms, a scoped member\'s code needs a fresh confirmation (S4)', async () => {
    const byAdmin = await product(clientA, 'Yogʻ kungaboqar tozalangan');
    const res = await send('post', `/api/products/${byAdmin}/confirm`, admin).send({ code });
    assert.equal(res.status, 200);
    matches(p.confirm.response, res.body, 'confirm');
    assert.equal(bodyOf<{ ok: true; product: { mxik: string } }>(res).product.mxik, code);
    assert.deepEqual(await entryFor('Yogʻ kungaboqar tozalangan'), { code, confirmations: 1, needsReconfirm: false });

    const byAccountant = await product(clientB, 'Makaron spagetti uzun');
    assert.equal(bodyOf<{ ok: boolean }>(await send('post', `/api/products/${byAccountant}/confirm`, accountant).send({ code })).ok, true);
    assert.deepEqual(await entryFor('Makaron spagetti uzun'), { code, confirmations: 1, needsReconfirm: false });

    const byScoped = await product(clientA, 'Choy koʻk xitoy');
    assert.equal(bodyOf<{ ok: boolean }>(await send('post', `/api/products/${byScoped}/confirm`, scoped).send({ code })).ok, true);
    assert.deepEqual(await entryFor('Choy koʻk xitoy'), { code, confirmations: 0, needsReconfirm: true });
    // An unscoped member confirming the same code afterwards makes it trusted.
    const again = await product(clientB, 'Choy koʻk xitoy');
    assert.equal(bodyOf<{ ok: boolean }>(await send('post', `/api/products/${again}/confirm`, admin).send({ code })).ok, true);
    assert.deepEqual(await entryFor('Choy koʻk xitoy'), { code, confirmations: 1, needsReconfirm: false });
  });

  it('confirm refuses another client\'s product, a malformed code and a code that is not live, changing nothing', async () => {
    const e = ta.productsX.confirmErrors;
    const productB = await product(clientB, 'Sovun xoʻjalik 72%');
    assert.deepEqual((await send('post', `/api/products/${productB}/confirm`, scoped).send({ code })).body, { ok: false, error: e.notFound });
    assert.deepEqual((await send('post', `/api/products/${productB}/confirm`, admin).send({ code: '123' })).body, { ok: false, error: e.format });
    assert.deepEqual((await send('post', `/api/products/${productB}/confirm`, admin).send({ code: '99999999999999999' })).body, { ok: false, error: e.notLive });
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: productB }, select: { mxik: true } })).mxik, null);
    assert.equal(await entryFor('Sovun xoʻjalik 72%'), null);
  });
});

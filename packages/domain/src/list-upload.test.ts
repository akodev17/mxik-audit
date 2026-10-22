import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { i18nFor } from '@tasnivo/i18n/locale';
import { db } from '@tasnivo/db';
import type { UploadedFile } from './catalog-upload.js';
import { makeClient, makePerson } from './firm-test-fixtures.js';
import {
  applyDocFile, applyPurchaseFile, removeDocFile, removePurchaseFile, restartDocFile, setActivityFor, uploadDocFile, uploadPurchaseFile,
} from './list-upload.js';
import { docListsPage, docReport, purchaseListsPage } from './list-pages.js';
import type { CurrentUser } from './session.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();
const { ta } = i18nFor('uz');
const e = ta.importX.errors;
const csv = (text: string): UploadedFile => ({ name: 'list.csv', size: Buffer.byteLength(text), read: () => Promise.resolve(Buffer.from(text)) });

describe('list uploads without a writer (no database)', () => {
  it('answer what the actions answered when writer() was null', async () => {
    assert.deepEqual(await uploadPurchaseFile(null, 'uz', { clientId: 'c', file: null }), { ok: false, error: e.client });
    assert.deepEqual(await uploadDocFile(null, 'uz', { clientId: 'c', kind: 'cheques', file: null }), { ok: false, error: e.client });
    assert.deepEqual(await applyPurchaseFile(null, 'uz', {}), { ok: false, error: e.client });
    assert.deepEqual(await removePurchaseFile(null, 'uz', 'x'), { ok: false, error: ta.importX.lists.deleteFailed });
    assert.deepEqual(await setActivityFor(null, { clientId: 'c', activity: 'savdo' }), { ok: false });
    assert.deepEqual(await applyDocFile(null, 'uz', {}), { ok: false, error: ta.importX.docs.startFailed });
    assert.deepEqual(await restartDocFile(null, 'uz', 'x'), { ok: false, error: ta.importX.docs.restartFailed });
    assert.deepEqual(await removeDocFile(null, 'uz', 'x'), { ok: false, error: ta.importX.lists.deleteFailed });
  });
});

describe('list uploads and screens (database)', { skip }, () => {
  const orgs: string[] = [];
  let admin: CurrentUser;
  let clientId = '';

  before(async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    await db.organization.update({ where: { id: org.orgId }, data: { subscriptionUntil: new Date(Date.now() + 86_400_000) } });
    admin = { ...(await makePerson(org.orgId, 'admin')), demo: false, clientId: null };
    clientId = await makeClient(org.orgId, 'Mijoz');
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('a purchase list: upload, the screen with its guessed mapping and sample, apply without codes is refused', async () => {
    const up = await uploadPurchaseFile(admin, 'uz', { clientId, file: csv('Nomi;MXIK\nUn;bad\nShakar;\n') });
    assert.ok(up.ok, JSON.stringify(up));
    assert.equal(up.preview.totalRows, 2);
    const page = await purchaseListsPage(admin, clientId);
    assert.equal(page?.client.activity, 'boshqa');
    assert.equal(page?.lists[0]?.id, up.preview.listId);
    assert.deepEqual(page?.lists[0]?.sample, [['Un', 'bad'], ['Shakar', '']]);
    assert.deepEqual(await applyPurchaseFile(admin, 'uz', { listId: up.preview.listId, map: up.preview.map }), { ok: false, error: ta.importX.purchases.zeroCodes });
    assert.equal(await purchaseListsPage(admin, 'no-such-client'), null);
  });

  it('a cheque list: an unknown kind is refused as the action did; the screens before the check', async () => {
    assert.deepEqual(await uploadDocFile(admin, 'uz', { clientId, kind: 'other', file: csv('a\nb\n') }), { ok: false, error: e.client });
    const up = await uploadDocFile(admin, 'uz', { clientId, kind: 'sales', file: csv('Nomi;MXIK;Summa\nUn;;100\n') });
    assert.ok(up.ok, JSON.stringify(up));
    const lists = await docListsPage(admin, clientId, 'sales');
    assert.equal(lists?.lists[0]?.status, 'uploaded');
    assert.equal(lists?.lists[0]?.sample.length, 1);
    assert.deepEqual((await docListsPage(admin, clientId, 'cheques'))?.lists, []);
    const report = await docReport(admin, up.preview.listId);
    assert.equal(report?.list.clientId, clientId);
    assert.deepEqual(report?.groups, [], 'no groups before the check finished');
    const viewerScoped = { ...(await makePerson(admin.orgId, 'accountant', [await makeClient(admin.orgId, 'Boshqa')])), demo: false, clientId: null };
    assert.equal(await docReport(viewerScoped, up.preview.listId), null, 'outside an accountant\'s clients');
    assert.deepEqual(await removeDocFile(admin, 'uz', up.preview.listId), { ok: true });
  });
});

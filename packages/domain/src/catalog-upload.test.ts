import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { i18nFor } from '@tasnivo/i18n/locale';
import { db } from '@tasnivo/db';
import {
  commitCatalogUpload, diagnoseCatalogUpload, discardCatalogUpload, formFile, previewCatalogUpload, removeCatalogFor, retryCatalogAudit, uploadTarget,
  type UploadedFile,
} from './catalog-upload.js';
import { makeClient, makePerson } from './firm-test-fixtures.js';
import type { CurrentUser } from './session.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();
const { t, ta } = i18nFor('uz');
const e = ta.importX.errors;

const file = (name: string, size: number): UploadedFile => ({ name, size, read: () => Promise.resolve(Buffer.alloc(size)) });

describe('upload wizard without a writer (no database)', () => {
  it('answers what the actions answered when writer() was null', async () => {
    assert.deepEqual(await previewCatalogUpload(null, 'uz', { file: file('a.xlsx', 10), clientId: null }), { ok: false, error: e.client });
    assert.deepEqual(await diagnoseCatalogUpload(null, 'uz', {}), { ok: false, error: e.client });
    assert.deepEqual(await commitCatalogUpload(null, 'uz', {}), { result: { ok: false, error: e.client }, clientId: null });
    assert.deepEqual(await discardCatalogUpload(null, 'uz', 'x'), { ok: false, error: e.discardFailed });
    assert.deepEqual(await retryCatalogAudit(null, 'x'), { ok: false });
    assert.deepEqual(await removeCatalogFor(null, 'uz', 'x'), { ok: false, error: t.errorGeneric });
    // The messages follow the locale.
    assert.deepEqual(await previewCatalogUpload(null, 'ru', { file: null, clientId: null }), { ok: false, error: i18nFor('ru').ta.importX.errors.client });
  });

  it('formFile reads a FormData file and ignores anything else', async () => {
    const f = formFile(new File([new Uint8Array([1, 2, 3])], 'Ro‘yxat.xlsx'));
    assert.equal(f?.name, 'Ro‘yxat.xlsx');
    assert.equal(f?.size, 3);
    assert.ok(f);
    assert.deepEqual([...(await f.read())], [1, 2, 3]);
    assert.equal(formFile('text'), null);
    assert.equal(formFile(null), null);
  });
});

describe('upload wizard refusals (database)', { skip }, () => {
  const orgs: string[] = [];
  let admin: CurrentUser;
  let clientId = '';

  before(async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    await db.organization.update({ where: { id: org.orgId }, data: { subscriptionUntil: new Date(Date.now() + 86_400_000) } });
    const person = await makePerson(org.orgId, 'admin');
    admin = { ...person, demo: false, clientId: null };
    clientId = await makeClient(org.orgId, 'Mijoz');
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('checks the file in the action\'s order: none, type, empty, too big', async () => {
    const preview = (f: UploadedFile | null) => previewCatalogUpload(admin, 'uz', { file: f, clientId });
    assert.deepEqual(await preview(null), { ok: false, error: e.none });
    assert.deepEqual(await preview(file('a.pdf', 0)), { ok: false, error: e.fileType }, 'the type before the size');
    assert.deepEqual(await preview(file('a.csv', 0)), { ok: false, error: e.zeroBytes });
    assert.deepEqual(await preview(file('a.xlsx', 20 * 1024 * 1024 + 1)), { ok: false, error: e.tooBig });
    assert.deepEqual(await preview({ name: 'a.xlsx', size: 4, read: () => Promise.resolve(Buffer.from('a;b\n')) }), { ok: false, error: e.empty });
  });

  it('a demo org is refused before the file is looked at; an archived or foreign client is refused', async () => {
    const demo = await makeOrg('demo', new Date(Date.now() + 3_600_000));
    orgs.push(demo.orgId);
    const demoAdmin = { ...(await makePerson(demo.orgId, 'admin')), demo: true, clientId: null };
    assert.deepEqual(await previewCatalogUpload(demoAdmin, 'uz', { file: null, clientId: null }), { ok: false, error: t.demoUploadDisabled });
    assert.deepEqual((await commitCatalogUpload(demoAdmin, 'uz', {})).result, { ok: false, error: t.demoUploadDisabled });

    const archived = await makeClient(admin.orgId, 'Arxiv', { archived: true });
    assert.deepEqual(await uploadTarget(admin, archived), { ok: false, reason: 'archived' });
    assert.deepEqual(await uploadTarget(admin, 'no-such-client'), { ok: false, reason: 'client' });
    assert.deepEqual(await uploadTarget(admin, clientId), { ok: true, id: clientId });
    const scoped = { ...(await makePerson(admin.orgId, 'accountant', [archived])), demo: false, clientId: null };
    assert.deepEqual(await uploadTarget(scoped, clientId), { ok: false, reason: 'client' }, 'a client outside the accountant\'s scope');
  });

  it('a viewer is refused like a missing writer', async () => {
    const viewer = { ...(await makePerson(admin.orgId, 'viewer')), demo: false, clientId: null };
    assert.deepEqual(await previewCatalogUpload(viewer, 'uz', { file: file('a.xlsx', 1), clientId }), { ok: false, error: e.client });
    assert.deepEqual(await retryCatalogAudit(viewer, 'x'), { ok: false });
  });

  it('commit and diagnose refuse a bad payload with the badMapping message, an unknown catalogue with notFound', async () => {
    assert.deepEqual(await diagnoseCatalogUpload(admin, 'uz', { catalogId: 'x', mapping: { name: 'a' } }), { ok: false, error: e.badMapping });
    assert.deepEqual(await diagnoseCatalogUpload(admin, 'uz', { catalogId: 'x', mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } }), { ok: false, error: e.notFound });
    assert.deepEqual((await commitCatalogUpload(admin, 'uz', 'nonsense')).result, { ok: false, error: e.badMapping });
    assert.deepEqual((await commitCatalogUpload(admin, 'uz', { catalogId: 'x', mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } })).result, { ok: false, error: e.notFound });
  });
});

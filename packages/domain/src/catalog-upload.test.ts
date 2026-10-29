import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { i18nFor } from '@tasnivo/i18n/locale';
import { db } from '@tasnivo/db';
import {
  commitCatalogUpload, diagnoseCatalogUpload, discardCatalogUpload, previewCatalogUpload, removeCatalogFor, retryCatalogAudit, uploadTarget,
  type UploadedFile,
} from './catalog-upload.js';
import { applyMapping } from './catalog-import.js';
import { makeClient, makePerson } from './firm-test-fixtures.js';
import type { CurrentUser } from './session.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';
import { uploadPreview } from './upload-preview.js';

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

  const csvFile = (text: string, name = 'k.csv'): UploadedFile => ({ name, size: Buffer.byteLength(text), read: () => Promise.resolve(Buffer.from(text, 'utf8')) });
  const CSV = 'Nomi;MXIK;Birlik;Izoh\nGuruch;06301001001000000;kg;a\n;;dona;jami\nShakar;;kg;b\n';

  it('diagnose keeps a valid mapping on the upload: coming back shows it, marked as the user\'s', async () => {
    const shown = await previewCatalogUpload(admin, 'uz', { file: csvFile(CSV), clientId });
    assert.ok(shown.ok);
    const { catalogId, mapping } = shown.preview;
    assert.equal(shown.preview.edited, false);
    const changed = { ...mapping, unit: -1, name: 3 };
    const diagnosed = await diagnoseCatalogUpload(admin, 'uz', { catalogId, mapping: changed });
    assert.ok(diagnosed.ok);
    assert.equal(diagnosed.diagnostics.noName.count, 0, 'under the new mapping every row has a "name"');
    const back = await uploadPreview(admin, catalogId);
    assert.deepEqual(back?.mapping, changed);
    assert.equal(back?.edited, true);
    assert.deepEqual(back?.diagnostics, diagnosed.diagnostics, 'with its diagnostics');
    // A mapping refused as invalid changes nothing.
    assert.deepEqual(await diagnoseCatalogUpload(admin, 'uz', { catalogId, mapping: { ...changed, unit: 3 } }), { ok: false, error: e.badMapping });
    assert.deepEqual((await uploadPreview(admin, catalogId))?.mapping, changed);
    // Back to the first mapping: kept too, still marked as edited.
    assert.ok((await diagnoseCatalogUpload(admin, 'uz', { catalogId, mapping })).ok);
    assert.deepEqual([(await uploadPreview(admin, catalogId))?.mapping, (await uploadPreview(admin, catalogId))?.edited], [mapping, true]);
  });

  it('the same file again names the earlier catalogue of that client; another client or another file does not', async () => {
    const first = await previewCatalogUpload(admin, 'uz', { file: csvFile(CSV, 'birinchi.csv'), clientId });
    assert.ok(first.ok);
    assert.equal(first.preview.sameFile, null, 'an open preview is not an earlier catalogue');
    const applied = await applyMapping(admin.orgId, first.preview.catalogId, first.preview.mapping);
    assert.deepEqual(applied, { rows: 2, skipped: 1 });

    const again = await previewCatalogUpload(admin, 'uz', { file: csvFile(CSV, 'qayta.csv'), clientId });
    assert.ok(again.ok);
    const earlier = await db.catalog.findUniqueOrThrow({ where: { id: first.preview.catalogId }, select: { createdAt: true } });
    assert.deepEqual(again.preview.sameFile, { id: first.preview.catalogId, filename: 'birinchi.csv', createdAt: earlier.createdAt.toISOString() });

    const otherClient = await makeClient(admin.orgId, 'Boshqa mijoz');
    const elsewhere = await previewCatalogUpload(admin, 'uz', { file: csvFile(CSV), clientId: otherClient });
    assert.ok(elsewhere.ok);
    assert.equal(elsewhere.preview.sameFile, null);
    const edited = await previewCatalogUpload(admin, 'uz', { file: csvFile(`${CSV}Tuz;;kg;c\n`), clientId });
    assert.ok(edited.ok);
    assert.equal(edited.preview.sameFile, null, 'one changed byte is another file');
  });

  it('commit and diagnose refuse a bad payload with the badMapping message, an unknown catalogue with notFound', async () => {
    assert.deepEqual(await diagnoseCatalogUpload(admin, 'uz', { catalogId: 'x', mapping: { name: 'a' } }), { ok: false, error: e.badMapping });
    assert.deepEqual(await diagnoseCatalogUpload(admin, 'uz', { catalogId: 'x', mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } }), { ok: false, error: e.notFound });
    assert.deepEqual((await commitCatalogUpload(admin, 'uz', 'nonsense')).result, { ok: false, error: e.badMapping });
    assert.deepEqual((await commitCatalogUpload(admin, 'uz', { catalogId: 'x', mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } })).result, { ok: false, error: e.notFound });
  });
});

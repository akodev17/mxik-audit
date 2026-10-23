// endpoints.catalogs and endpoints.share through the real app against the development database:
// upload a small spreadsheet, commit it, watch the in-process audit reach "ready", read every
// catalogue screen's data, download every file, share it, review it, and the refusals.
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
const c = endpoints.catalogs;
const { t, ta } = i18nFor('uz');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Preview = { ok: true; preview: { catalogId: string; mapping: Record<string, number>; client: { id: string } } } | { ok: false; error: string };

describe('catalogs + share (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let owner: TestUser;
  let cookie = '';
  let clientId = '';
  let catalogId = '';
  let file: Buffer;

  const http = () => request(serverOf(app));
  const post = (path: string, who = cookie) => http().post(path).set('Cookie', who).set('X-Requested-With', 'tasnivo');
  const upload = (buffer: Buffer, name: string, who = cookie, fields: Record<string, string> = { clientId }) => {
    let req = post('/api/catalogs/preview', who);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', buffer, name);
  };

  before(async () => {
    // The audit runs in this process whatever JOBS_MODE the environment sets.
    setJobs(new InlineDispatcher());
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    // A paying firm: a fresh customer org has no trial, so uploads would be refused as expired.
    await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    clientId = await makeClient(owner.orgId, 'Test mijoz');
    cookie = await sessionCookie(owner);
    const [a = '', b = ''] = await liveCodes(2);
    file = await xlsx([['Nomi', 'MXIK kodi', 'Birlik'], ['Kartoshka', a, 'kg'], ['Guruch', b, 'kg'], ['Sut', '', 'l']]);
  });
  after(async () => {
    setJobs(null);
    delete process.env['BILLING_REQUIRED_FOR_EXPORT'];
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('upload options: the clients to upload for and the plan gate', async () => {
    const res = await http().get('/api/upload/options').set('Cookie', cookie);
    assert.equal(res.status, 200);
    matches(c.uploadOptions.response, res.body, 'uploadOptions');
    const options = bodyOf<{ clients: { id: string }[]; uploadsOpen: boolean }>(res);
    assert.ok(options.clients.some((x) => x.id === clientId));
    assert.equal(options.uploadsOpen, true);
  });

  it('preview → diagnose → commit → progress reaches ready (inline audit)', async () => {
    const res = await upload(file, 'Narxlar ro‘yxati.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(c.previewUpload.response, res.body, 'previewUpload');
    const preview = bodyOf<Preview>(res);
    assert.ok(preview.ok, JSON.stringify(preview));
    catalogId = preview.preview.catalogId;
    assert.equal(preview.preview.client.id, clientId);

    const again = await http().get(`/api/catalogs/${catalogId}/preview`).set('Cookie', cookie);
    assert.equal(again.status, 200);
    matches(c.preview.response, again.body, 'preview');
    assert.equal(bodyOf<{ filename: string }>(again).filename, 'Narxlar ro‘yxati.xlsx', 'a UTF-8 file name survives multipart');

    const mapping = preview.preview.mapping;
    const diagnosed = await post(`/api/catalogs/${catalogId}/diagnose`).send({ mapping });
    assert.equal(diagnosed.status, 200);
    matches(c.diagnose.response, diagnosed.body, 'diagnose');
    assert.equal(bodyOf<{ ok: boolean }>(diagnosed).ok, true);
    const bad = await post(`/api/catalogs/${catalogId}/diagnose`).send({ mapping: { name: 99 } });
    assert.deepEqual(bad.body, { ok: false, error: ta.importX.errors.badMapping }, 'a bad payload is the action\'s refusal, not a 400');

    const committed = await post(`/api/catalogs/${catalogId}/commit`).send({ mapping });
    assert.equal(committed.status, 200, JSON.stringify(committed.body));
    assert.deepEqual(committed.body, { ok: true, catalogId });
    assert.ok(String(committed.headers['set-cookie'] ?? '').includes('mxik_audit_session='), 'the uploaded client becomes the active one');
    const twice = await post(`/api/catalogs/${catalogId}/commit`).send({ mapping });
    assert.deepEqual(twice.body, { ok: false, error: ta.importX.errors.alreadyCommitted, committed: true });

    const ready = await eventually(async () => {
      const p = await http().get(`/api/catalogs/${catalogId}/progress`).set('Cookie', cookie);
      assert.equal(p.status, 200);
      assert.equal(p.headers['cache-control'], 'no-store');
      matches(c.progress.response, p.body, 'progress');
      const body = bodyOf<{ status: string }>(p);
      assert.notEqual(body.status, 'failed');
      return body.status === 'ready' ? body : undefined;
    }, 180_000, 'the audit');
    matches(c.progress.response, ready);
  });

  it('the catalogue screens: list, header, summary, versions, diff, report, review', async () => {
    const list = await http().get('/api/catalogs').query({ clientId: 'all' }).set('Cookie', cookie);
    assert.equal(list.status, 200);
    matches(c.list.response, list.body, 'list');
    assert.ok(bodyOf<{ items: { id: string }[] }>(list).items.some((i) => i.id === catalogId));

    for (const [path, schema] of [
      [`/api/catalogs/${catalogId}`, c.get.response],
      [`/api/catalogs/${catalogId}/summary`, c.summary.response],
      [`/api/catalogs/${catalogId}/versions`, c.versions.response],
      [`/api/catalogs/${catalogId}/report`, c.report.response],
      [`/api/catalogs/${catalogId}/review`, c.review.response],
    ] as const) {
      const res = await http().get(path).set('Cookie', cookie);
      assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body)}`);
      matches(schema, res.body, path);
    }
    const header = await http().get(`/api/catalogs/${catalogId}`).set('Cookie', cookie);
    assert.equal(bodyOf<{ status: string }>(header).status, 'ready');
    // The first catalogue of the client has nothing to compare with: JSON null, not an empty body.
    const diff = await http().get(`/api/catalogs/${catalogId}/diff`).set('Cookie', cookie);
    assert.equal(diff.status, 200);
    assert.match(String(diff.headers['content-type']), /application\/json/);
    assert.equal(diff.text, 'null');
  });

  it('downloads: xlsx, 1C csv and xlsx, report CSV, PDF inline and attachment; diff CSV 404 without a previous version', async () => {
    const get = (path: string) => http().get(path).set('Cookie', cookie).buffer(true).parse(binary);
    const xlsxRes = await get(`/api/export?catalog=${catalogId}`);
    assert.equal(xlsxRes.status, 200);
    assert.equal(xlsxRes.headers['content-type'], XLSX);
    assert.match(String(xlsxRes.headers['content-disposition']), /^attachment; filename="Narxlar ro_yxati-.*\.xlsx"; filename\*=UTF-8''Narxlar%20ro%E2%80%98yxati-/);
    assert.equal((xlsxRes.body as Buffer).subarray(0, 2).toString(), 'PK');
    const oneC = await get(`/api/export?catalog=${catalogId}&format=1c`);
    assert.equal(oneC.status, 200);
    assert.equal(oneC.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal((await get(`/api/export?catalog=${catalogId}&format=1c-xlsx`)).headers['content-type'], XLSX);
    assert.equal((await get(`/api/export?catalog=${catalogId}&format=nonsense`)).headers['content-type'], XLSX, 'an unknown format is xlsx, as before');

    const csv = await get(`/api/catalog-report-csv?catalog=${catalogId}`);
    assert.equal(csv.status, 200);
    assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(csv.headers['cache-control'], 'private, no-store');
    assert.match(String(csv.headers['content-disposition']), /-topilmalar\.csv/);

    const inline = await get(`/api/report-pdf?catalog=${catalogId}`);
    assert.equal(inline.status, 200);
    assert.equal(inline.headers['content-type'], 'application/pdf');
    assert.match(String(inline.headers['content-disposition']), /^inline; /);
    assert.equal((inline.body as Buffer).subarray(0, 5).toString(), '%PDF-');
    const client = await get(`/api/report-pdf?catalog=${catalogId}&audience=client&download=1`);
    assert.match(String(client.headers['content-disposition']), new RegExp(`^attachment; .*-${ta.importX.exp.suffix.pdfClient}\\.pdf`));

    const diffCsv = await http().get(`/api/catalog-diff?catalog=${catalogId}`).set('Cookie', cookie);
    assert.equal(diffCsv.status, 404);
    assert.equal(bodyOf(diffCsv).error.code, 'nothing_to_compare');
    const exported = await db.auditEvent.count({ where: { orgId: owner.orgId, action: { in: ['catalog.exported', 'catalog.report_csv_exported', 'catalog.pdf_exported'] } } });
    assert.ok(exported >= 6, 'every download is logged as before');
  });

  it('402 while billing requires payment for exports, 409 before the audit finished', async () => {
    // A subscription pays for every export: without one and without an order, the file waits for payment.
    await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: null } });
    process.env['BILLING_REQUIRED_FOR_EXPORT'] = 'true';
    try {
      const res = await http().get(`/api/export?catalog=${catalogId}`).set('Cookie', cookie);
      assert.equal(res.status, 402);
      assert.equal(bodyOf(res).error.code, 'payment_required');
      const header = await http().get(`/api/catalogs/${catalogId}`).set('Cookie', cookie);
      assert.equal(bodyOf<{ exportLocked: boolean }>(header).exportLocked, true);
    } finally {
      delete process.env['BILLING_REQUIRED_FOR_EXPORT'];
      await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    }
    const pending = await db.catalog.create({ data: { orgId: owner.orgId, clientId, filename: 'kutish.xlsx', rowCount: 0, status: 'analyzing', headers: [], columnMap: {}, auditHeartbeatAt: new Date() } });
    for (const path of [`/api/export?catalog=${pending.id}`, `/api/report-pdf?catalog=${pending.id}`, `/api/catalog-report-csv?catalog=${pending.id}`, `/api/catalogs/${pending.id}/report`]) {
      const res = await http().get(path).set('Cookie', cookie);
      assert.equal(res.status, 409, path);
      assert.equal(bodyOf(res).error.code, 'audit_not_finished');
    }
  });

  it('share links: create, list, the public view counts a view, its PDF, revoke', async () => {
    const created = await post(`/api/catalogs/${catalogId}/share-links`).send({ days: 7, includePdf: true });
    assert.equal(created.status, 200);
    matches(c.createShareLink.response, created.body);
    const { url } = bodyOf<{ url: string }>(created);
    const token = url.split('/r/')[1] ?? '';
    assert.ok(token.length > 10);

    const view = await http().get(`/api/share/${token}`);
    assert.equal(view.status, 200, 'no session needed');
    matches(endpoints.share.view.response, view.body, 'share.view');
    const shared = bodyOf<{ includePdf: boolean; report: { rows: { decidedBy: string | null }[] } }>(view);
    assert.equal(shared.includePdf, true);
    assert.ok(shared.report.rows.every((r) => r.decidedBy === null), 'who decided never reaches the share page');
    const pdf = await http().get(`/api/share/${token}/pdf`).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.headers['x-robots-tag'], 'noindex');
    assert.equal(pdf.headers['cache-control'], 'private, no-store');
    assert.match(String(pdf.headers['content-disposition']), /^inline; /);

    const links = await http().get(`/api/catalogs/${catalogId}/share-links`).set('Cookie', cookie);
    matches(c.shareLinks.response, links.body);
    const [link] = bodyOf<{ id: string; views: number }[]>(links);
    assert.equal(link?.views, 1);

    const revoked = await http().delete(`/api/share-links/${link?.id ?? ''}`).set('Cookie', cookie).set('X-Requested-With', 'tasnivo');
    assert.equal(revoked.text, 'true');
    assert.equal((await http().get(`/api/share/${token}`)).status, 404);
    assert.equal((await http().get(`/api/share/${token}/pdf`)).status, 404);
    assert.equal((await http().get('/api/share/not-a-token')).status, 404);
  });

  it('review: assign to a member, finish', async () => {
    const accountant = await makePerson(owner.orgId, 'accountant');
    const assigned = await http().put(`/api/catalogs/${catalogId}/review`).set('Cookie', cookie).set('X-Requested-With', 'tasnivo')
      .send({ assigneeId: accountant.userId, dueOn: null, note: 'Tekshiring' });
    assert.equal(assigned.status, 200);
    assert.deepEqual(assigned.body, { ok: true, changed: true });
    const review = await http().get(`/api/catalogs/${catalogId}/review`).set('Cookie', cookie);
    assert.equal(bodyOf<{ review: { assigneeId: string } }>(review).review.assigneeId, accountant.userId);
    const done = await post(`/api/catalogs/${catalogId}/review/done`).send({ note: null });
    assert.deepEqual(done.body, { ok: true });
    const again = await post(`/api/catalogs/${catalogId}/review/done`).send({ note: null });
    assert.deepEqual(again.body, { ok: false, error: ta.review.errors['already done'] });
  });

  it('a second version: the diff against the previous one, and its CSV', async () => {
    const res = await upload(await xlsx([['Nomi', 'MXIK kodi', 'Birlik'], ['Kartoshka', '', 'kg'], ['Non', '', 'dona']]), 'Narxlar-2.xlsx');
    const preview = bodyOf<Preview>(res);
    assert.ok(preview.ok, JSON.stringify(preview));
    const next = preview.preview.catalogId;
    assert.deepEqual((await post(`/api/catalogs/${next}/commit`).send({ mapping: preview.preview.mapping })).body, { ok: true, catalogId: next });
    await eventually(async () => {
      const p = bodyOf<{ status: string }>(await http().get(`/api/catalogs/${next}/progress`).set('Cookie', cookie));
      assert.notEqual(p.status, 'failed');
      return p.status === 'ready' ? true : undefined;
    }, 180_000, 'the second audit');

    const diff = await http().get(`/api/catalogs/${next}/diff`).query({ limit: 10 }).set('Cookie', cookie);
    assert.equal(diff.status, 200);
    matches(c.diff.response, diff.body, 'diff');
    const d = bodyOf<{ previousId: string; counts: { added: number; removed: number } }>(diff);
    assert.equal(d.previousId, catalogId);
    assert.ok(d.counts.added >= 1 && d.counts.removed >= 1);
    const versions = bodyOf<{ id: string }[]>(await http().get(`/api/catalogs/${next}/versions`).set('Cookie', cookie));
    assert.ok(versions.some((v) => v.id === catalogId));

    const csv = await http().get(`/api/catalog-diff?catalog=${next}&with=${catalogId}`).set('Cookie', cookie);
    assert.equal(csv.status, 200);
    assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
    assert.match(String(csv.headers['content-disposition']), /Narxlar-2-farq\.csv/);
  });

  it('upload refusals in the user\'s language: file type, empty file, too big, CSRF', async () => {
    const e = ta.importX.errors;
    assert.deepEqual((await upload(Buffer.from('%PDF-1.4'), 'hujjat.pdf')).body, { ok: false, error: e.fileType });
    assert.deepEqual((await upload(Buffer.alloc(0), 'bo‘sh.xlsx')).body, { ok: false, error: e.zeroBytes });
    const big = await upload(Buffer.alloc(20 * 1024 * 1024 + 1, 1), 'katta.xlsx');
    assert.equal(big.status, 200, 'over 20 MB is the action\'s refusal, not a 413');
    assert.deepEqual(big.body, { ok: false, error: e.tooBig });
    assert.deepEqual((await post('/api/catalogs/preview').field('clientId', clientId)).body, { ok: false, error: e.none });
    const ru = await upload(Buffer.from('x'), 'hujjat.pdf', `${cookie}; mxik_locale=ru`);
    assert.deepEqual(ru.body, { ok: false, error: i18nFor('ru').ta.importX.errors.fileType });
    const noCsrf = await http().post('/api/catalogs/preview').set('Cookie', cookie).attach('file', file, 'a.xlsx');
    assert.equal(noCsrf.status, 403);
    assert.equal(bodyOf(noCsrf).error.code, 'csrf');
  });

  it('discard an open preview, delete a catalogue, retry only a failed one', async () => {
    const res = await upload(file, 'ikkinchi.xlsx');
    const preview = bodyOf<Preview>(res);
    assert.ok(preview.ok, JSON.stringify(preview));
    const id = preview.preview.catalogId;
    const del = () => http().delete(`/api/catalogs/${id}/preview`).set('Cookie', cookie).set('X-Requested-With', 'tasnivo');
    assert.deepEqual((await del()).body, { ok: true });
    assert.deepEqual((await del()).body, { ok: false, error: ta.importX.errors.notFound });

    assert.deepEqual((await post(`/api/catalogs/${catalogId}/retry`).send()).body, { ok: false }, 'a ready audit is not retried');
    const failed = await db.catalog.create({ data: { orgId: owner.orgId, clientId, filename: 'xato.xlsx', rowCount: 0, status: 'failed', headers: [], columnMap: {} } });
    const removed = await http().delete(`/api/catalogs/${failed.id}`).set('Cookie', cookie).set('X-Requested-With', 'tasnivo');
    assert.deepEqual(removed.body, { ok: true, rows: 0 });
    assert.deepEqual((await http().delete(`/api/catalogs/${failed.id}`).set('Cookie', cookie).set('X-Requested-With', 'tasnivo')).body, { ok: false, error: t.errorGeneric });
  });

  it('another org\'s catalogue is a 404 everywhere; a viewer may not write; a demo org may not upload', async () => {
    const stranger = await makeUser();
    orgs.push(stranger.orgId);
    const other = await sessionCookie(stranger);
    for (const path of [
      `/api/catalogs/${catalogId}`, `/api/catalogs/${catalogId}/progress`, `/api/catalogs/${catalogId}/summary`, `/api/catalogs/${catalogId}/report`,
      `/api/catalogs/${catalogId}/diff`, `/api/catalogs/${catalogId}/versions`, `/api/catalogs/${catalogId}/review`,
      `/api/export?catalog=${catalogId}`, `/api/report-pdf?catalog=${catalogId}`, `/api/catalog-report-csv?catalog=${catalogId}`, `/api/catalog-diff?catalog=${catalogId}`,
    ]) {
      const res = await http().get(path).set('Cookie', other);
      assert.equal(res.status, 404, path);
    }
    assert.equal((await http().get(`/api/catalogs/${catalogId}/preview`).set('Cookie', other)).text, 'null');
    assert.deepEqual((await post(`/api/catalogs/${catalogId}/share-links`, other).send({ days: 7, includePdf: false })).text, 'null');

    const viewer = await makePerson(owner.orgId, 'viewer');
    const viewerCookie = await sessionCookie(viewer);
    const refused = await upload(file, 'a.xlsx', viewerCookie);
    assert.equal(refused.status, 403);
    assert.equal(bodyOf(refused).error.code, 'forbidden');
    assert.equal((await http().get(`/api/catalogs/${catalogId}/share-links`).set('Cookie', viewerCookie)).status, 403);
    assert.equal((await http().get(`/api/catalogs/${catalogId}`).set('Cookie', viewerCookie)).status, 200, 'a viewer still reads');
    assert.equal((await http().get('/api/catalogs').set('Cookie', '')).status, 401);

    const demo = await makeUser({ kind: 'demo', expiresAt: new Date(Date.now() + 3_600_000) });
    orgs.push(demo.orgId);
    const demoCookie = await sessionCookie(demo, { demo: true });
    const demoClient = await makeClient(demo.orgId, 'Demo mijoz');
    // noDemo endpoints: the registry's AccessGuard refuses a demo org with 403 `demo` before the handler.
    const demoRefused = (res: { status: number; body: unknown }) => {
      assert.equal(res.status, 403);
      assert.equal(bodyOf(res).error.code, 'demo');
    };
    demoRefused(await upload(file, 'a.xlsx', demoCookie, { clientId: demoClient }));
    demoRefused(await post(`/api/catalogs/${catalogId}/commit`, demoCookie).send({ mapping: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } }));
    demoRefused(await http().put(`/api/catalogs/${catalogId}/review`).set('Cookie', demoCookie).set('X-Requested-With', 'tasnivo').send({ assigneeId: demo.userId, dueOn: null, note: null }));
    assert.equal((await http().get(`/api/catalogs/${catalogId}/progress`).set('Cookie', demoCookie)).status, 404, 'reads are not refused, only scoped');
  });
});

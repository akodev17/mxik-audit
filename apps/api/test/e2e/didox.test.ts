// endpoints.didox through the real app against the development database: upload a Didox zip →
// batches and records → detail → decisions → bulk approve → the "Prepare for 1C" report, the
// print form, the 1C export refusal while Agent 1's builder is a stub, duplicates, roles, and the
// connection settings (the token never comes back).
import '../setup-env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import JSZip from 'jszip';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { FIXTURE_DIR, fakePdf } from '@tasnivo/domain/didox/fake-server';
import { makeClient, makePerson } from '@tasnivo/domain/firm-test-fixtures';
import { liveCodes } from '@tasnivo/domain/test-fixtures';
import ExcelJS from 'exceljs';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { binary, matches, sessionCookie } from '../upload-fixtures';
/** A sheet cell as text (ExcelJS cells may be rich objects). */
const cellText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : v == null ? '' : JSON.stringify(v));


const skip = await dbSkipReason();
const dx = endpoints.didox;
const raw = (name: string): Buffer => readFileSync(join(FIXTURE_DIR, name));
process.env['TASNIF_LIVE'] = 'false';

/** The standard fixture with live classifier codes, so the real classifier does not call every line not-found. */
function standardWithLiveCodes(codes: string[]): Buffer {
  const doc = JSON.parse(raw('invoice-standard-3.json').toString()) as { productlist: { products: Array<{ catalogcode: string }> } };
  doc.productlist.products.forEach((p, i) => { p.catalogcode = codes[i] ?? p.catalogcode; });
  return Buffer.from(JSON.stringify(doc));
}

async function sheetCells(body: Buffer): Promise<string[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(body as unknown as Parameters<typeof book.xlsx.load>[0]);
  return book.worksheets.flatMap((ws) => ws.getSheetValues().flatMap((row) => (Array.isArray(row) ? row.map(cellText) : [])));
}

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer' });
}

type Uploaded = { ok: true; kind: 'documents'; items: Array<{ ok: boolean; batchId?: string; code?: string; duplicateOf?: { batchId: string } }> };
type Detail = { records: Array<{ id: string; status: string; payload: { lineNo: number } }>; invoice: { hasPdf: boolean; status: string } };

describe('didox (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let owner: TestUser;
  let cookie = '';
  let viewerCookie = '';
  let clientId = '';
  const ids = { standard: '', noisy: '' };
  let codes: string[] = [];

  const http = () => request(serverOf(app));
  const send = (method: 'post' | 'put' | 'delete', path: string, who = cookie) => http()[method](path).set('Cookie', who).set('X-Requested-With', 'tasnivo');

  before(async () => {
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    // A paying firm: a fresh customer org has no trial, so its uploads would be refused as expired.
    await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    clientId = await makeClient(owner.orgId, 'Didox mijoz');
    cookie = await sessionCookie(owner);
    viewerCookie = await sessionCookie(await makePerson(owner.orgId, 'viewer'));
    codes = await liveCodes(4);
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('upload a zip of zips → one batch per invoice, the act refused', async () => {
    const zip = await zipOf({
      'a.zip': await zipOf({ 'doc.json': standardWithLiveCodes(codes), 'doc.pdf': fakePdf('EF-2026/0417') }),
      'b.zip': await zipOf({ 'doc.json': raw('invoice-noisy.json') }),
      'c.zip': await zipOf({ 'doc.json': raw('act.json') }),
    });
    const res = await send('post', '/api/didox/upload').field('clientId', clientId).attach('file', zip, 'didox.zip');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(dx.upload.response, res.body, 'upload');
    const up = bodyOf<Uploaded>(res);
    assert.deepEqual(up.items.map((i) => i.ok), [true, true, false]);
    assert.equal(up.items[2]?.code, 'not_invoice');
    ids.standard = up.items[0]?.batchId ?? '';
    ids.noisy = up.items[1]?.batchId ?? '';

    const again = await send('post', '/api/didox/upload').attach('file', standardWithLiveCodes(codes), 'doc.json');
    const dup = bodyOf<Uploaded>(again).items[0];
    assert.equal(dup?.code, 'duplicate_invoice');
    assert.equal(dup?.duplicateOf?.batchId, ids.standard);
  });

  it('an ended trial closes the upload, like the bank path (Phase C F1)', async () => {
    const expired = await makeUser();
    orgs.push(expired.orgId);
    await db.organization.update({ where: { id: expired.orgId }, data: { trialEndsAt: new Date(Date.now() - 86_400_000) } });
    const res = await send('post', '/api/didox/upload', await sessionCookie(expired)).attach('file', raw('invoice-vat0-pinfl.json'), 'x.json');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, { ok: false, error: i18nFor('uz').ta.didoxX.errors.expired });
    assert.equal(await db.importBatch.count({ where: { orgId: expired.orgId } }), 0);
  });

  it('a viewer may read but not upload or decide; CSRF header required', async () => {
    const refused = await send('post', '/api/didox/upload', viewerCookie).attach('file', raw('invoice-vat0-pinfl.json'), 'x.json');
    assert.equal(refused.status, 403);
    const noCsrf = await http().post('/api/didox/upload').set('Cookie', cookie).attach('file', raw('invoice-vat0-pinfl.json'), 'x.json');
    assert.equal(noCsrf.status, 403);
    const list = await http().get('/api/didox/invoices').set('Cookie', viewerCookie);
    assert.equal(list.status, 200);
    assert.equal(bodyOf<{ total: number }>(list).total, 2);
  });

  it('list and detail answer the contract; the print form is a PDF', async () => {
    const list = await http().get('/api/didox/invoices').set('Cookie', cookie);
    matches(dx.list.response, list.body, 'list');
    assert.deepEqual(bodyOf<{ connection: unknown }>(list).connection, { connected: false, lastSyncAt: null, lastError: null });
    const detail = await http().get(`/api/didox/invoices/${ids.noisy}`).set('Cookie', cookie);
    assert.equal(detail.status, 200);
    matches(dx.get.response, detail.body, 'get');
    // Real classifier: the sugar has no code and the flour a 16-digit one, so both are errors.
    const statuses = bodyOf<Detail>(detail).records.map((r) => r.status);
    assert.equal(statuses[1], 'unresolved');
    assert.equal(statuses[2], 'unresolved');
    const pdf = await http().get(`/api/didox/invoices/${ids.standard}/pdf`).set('Cookie', cookie).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal((pdf.body as Buffer).subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal((await http().get(`/api/didox/invoices/${ids.noisy}/pdf`).set('Cookie', cookie)).status, 404);
    assert.equal((await http().get('/api/didox/invoices/nope').set('Cookie', cookie)).status, 404);
  });

  it('decisions → prepare → the real receipt_xlsx and nomenclature_xlsx (Agent 1), products created (Agent 4)', async () => {
    const detail = bodyOf<Detail>(await http().get(`/api/didox/invoices/${ids.noisy}`).set('Cookie', cookie));
    const [oil, sugar, flour, rice, tea] = detail.records;
    assert.equal((await send('put', `/api/didox/records/${oil?.id}/decision`, viewerCookie).send({ action: 'approve' })).status, 403);
    const refused = await send('put', `/api/didox/records/${sugar?.id}/decision`).send({ action: 'approve' });
    assert.equal(bodyOf<{ ok: boolean }>(refused).ok, false, 'an error must be corrected first');
    const fixed = await send('put', `/api/didox/records/${sugar?.id}/decision`).send({ action: 'correct', corrections: { mxik: codes[3], product: 'new' } });
    matches(dx.decide.response, fixed.body, 'decide');
    assert.equal(bodyOf<{ status: string }>(fixed).status, 'corrected', JSON.stringify(fixed.body));
    for (const r of [oil, flour, rice, tea]) await send('put', `/api/didox/records/${r?.id}/decision`).send({ action: 'skip' });

    const prepared = await send('post', `/api/didox/invoices/${ids.noisy}/prepare`);
    matches(dx.prepare.response, prepared.body, 'prepare');
    const p = bodyOf<{ report: { imported: number; skipped: number; rejected: number; newProducts: number }; onec: { ok: boolean; records: number } }>(prepared);
    assert.deepEqual([p.report.imported, p.report.skipped, p.report.rejected, p.report.newProducts], [1, 4, 0, 1]);
    assert.equal(p.onec.ok, true, JSON.stringify(p.onec));
    assert.equal(p.onec.records, 1);

    const receipt = await send('post', `/api/didox/invoices/${ids.noisy}/export?format=receipt_xlsx`).buffer(true).parse(binary);
    assert.equal(receipt.status, 200, `export answered ${receipt.status}`);
    assert.match(String(receipt.headers['content-type']), /spreadsheetml/);
    const cells = await sheetCells(receipt.body as Buffer);
    assert.ok(cells.includes('Сахар-песок 50 кг'));
    assert.ok(cells.includes(codes[3] ?? ''), 'the corrected MXIK is in the file');
    assert.ok(!cells.includes('Мука в/с 25кг'), 'skipped lines stay out');
    assert.equal(await db.product.count({ where: { orgId: owner.orgId, source: 'didox', name: 'Сахар-песок 50 кг' } }), 1, 'the new product was created');

    // The standard invoice (live codes): approve every line, then the new products file.
    const std = bodyOf<Detail>(await http().get(`/api/didox/invoices/${ids.standard}`).set('Cookie', cookie));
    for (const r of std.records) {
      const res = await send('put', `/api/didox/records/${r.id}/decision`).send({ action: 'approve' });
      assert.equal(bodyOf<{ ok: boolean }>(res).ok, true, JSON.stringify(res.body));
    }
    const after = bodyOf<Detail>(await http().get(`/api/didox/invoices/${ids.standard}`).set('Cookie', cookie));
    assert.equal(after.invoice.status, 'approved');
    const nomenclature = await send('post', `/api/didox/invoices/${ids.standard}/export?format=nomenclature_xlsx`).buffer(true).parse(binary);
    assert.equal(nomenclature.status, 200, `export answered ${nomenclature.status}`);
    const names = await sheetCells(nomenclature.body as Buffer);
    for (const name of ['Цемент М400 50кг', 'Арматура А500С 12мм', 'Кирпич облицовочный красный']) assert.ok(names.includes(name), name);
    const bulk = await send('post', `/api/didox/invoices/${ids.standard}/approve`).send({ scope: 'clean' });
    matches(dx.approveMany.response, bulk.body, 'approveMany');
    assert.equal(bodyOf<{ approved: number }>(bulk).approved, 0, 'nothing left undecided');
  });

  it('connection: admin only, token stored sealed and never answered', async () => {
    assert.equal((await http().get('/api/didox/connection').set('Cookie', viewerCookie)).status, 403);
    const saved = await send('put', '/api/didox/connection').send({ kind: 'token', companyTin: '305123456', token: 'very-secret-token', clientId });
    assert.deepEqual(saved.body, { ok: true });
    const view = await http().get('/api/didox/connection').set('Cookie', cookie);
    matches(dx.connection.response, view.body, 'connection');
    assert.ok(!JSON.stringify(view.body).includes('very-secret-token'));
    assert.equal(bodyOf<{ hasToken: boolean; clientId: string }>(view).hasToken, true);
    const login = await send('post', '/api/didox/connection/login').send({ companyTin: '305123456', password: 'x' });
    assert.equal(bodyOf<{ ok: boolean }>(login).ok, false, 'password login is off by default');
    assert.deepEqual((await send('delete', '/api/didox/connection')).body, { ok: true });
  });

  it('delete an invoice', async () => {
    assert.deepEqual((await send('delete', `/api/didox/invoices/${ids.standard}`, viewerCookie)).status, 403);
    assert.deepEqual((await send('delete', `/api/didox/invoices/${ids.standard}`)).body, { ok: true });
    assert.equal((await http().get(`/api/didox/invoices/${ids.standard}`).set('Cookie', cookie)).status, 404);
  });
});

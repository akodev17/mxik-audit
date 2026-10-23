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
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { binary, matches, sessionCookie } from '../upload-fixtures';

const skip = await dbSkipReason();
const dx = endpoints.didox;
const raw = (name: string): Buffer => readFileSync(join(FIXTURE_DIR, name));

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

  const http = () => request(serverOf(app));
  const send = (method: 'post' | 'put' | 'delete', path: string, who = cookie) => http()[method](path).set('Cookie', who).set('X-Requested-With', 'tasnivo');

  before(async () => {
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    clientId = await makeClient(owner.orgId, 'Didox mijoz');
    cookie = await sessionCookie(owner);
    viewerCookie = await sessionCookie(await makePerson(owner.orgId, 'viewer'));
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('upload a zip of zips → one batch per invoice, the act refused', async () => {
    const zip = await zipOf({
      'a.zip': await zipOf({ 'doc.json': raw('invoice-standard-3.json'), 'doc.pdf': fakePdf('EF-2026/0417') }),
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

    const again = await send('post', '/api/didox/upload').attach('file', raw('invoice-standard-3.json'), 'doc.json');
    const dup = bodyOf<Uploaded>(again).items[0];
    assert.equal(dup?.code, 'duplicate_invoice');
    assert.equal(dup?.duplicateOf?.batchId, ids.standard);
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
    assert.deepEqual(bodyOf<Detail>(detail).records.map((r) => r.status), ['valid', 'unresolved', 'unresolved', 'unresolved', 'suspicious']);
    const pdf = await http().get(`/api/didox/invoices/${ids.standard}/pdf`).set('Cookie', cookie).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal((pdf.body as Buffer).subarray(0, 5).toString('latin1'), '%PDF-');
    assert.equal((await http().get(`/api/didox/invoices/${ids.noisy}/pdf`).set('Cookie', cookie)).status, 404);
    assert.equal((await http().get('/api/didox/invoices/nope').set('Cookie', cookie)).status, 404);
  });

  it('decisions, bulk approve and the prepare report; the export refuses while 1C is a stub', async () => {
    const detail = bodyOf<Detail>(await http().get(`/api/didox/invoices/${ids.noisy}`).set('Cookie', cookie));
    const [oil, sugar, flour, rice, tea] = detail.records;
    assert.equal((await send('put', `/api/didox/records/${oil?.id}/decision`, viewerCookie).send({ action: 'approve' })).status, 403);
    const ok = await send('put', `/api/didox/records/${oil?.id}/decision`).send({ action: 'approve' });
    matches(dx.decide.response, ok.body, 'decide');
    assert.equal(bodyOf<{ status: string }>(ok).status, 'valid');
    const refused = await send('put', `/api/didox/records/${sugar?.id}/decision`).send({ action: 'approve' });
    assert.equal(bodyOf<{ ok: boolean }>(refused).ok, false);
    await send('put', `/api/didox/records/${sugar?.id}/decision`).send({ action: 'correct', corrections: { mxik: '17019910001000000', product: 'new' } });
    await send('put', `/api/didox/records/${flour?.id}/decision`).send({ action: 'skip' });
    await send('put', `/api/didox/records/${rice?.id}/decision`).send({ action: 'correct', corrections: { mxik: '10063010001000000' } });
    await send('put', `/api/didox/records/${tea?.id}/decision`).send({ action: 'approve' });

    const prepared = await send('post', `/api/didox/invoices/${ids.noisy}/prepare`);
    matches(dx.prepare.response, prepared.body, 'prepare');
    const p = bodyOf<{ report: { imported: number; skipped: number; rejected: number }; onec: { ok: boolean; error: string } }>(prepared);
    assert.deepEqual([p.report.imported, p.report.skipped, p.report.rejected], [4, 1, 0]);
    assert.deepEqual(p.onec, { ok: false, error: 'not_implemented' });

    const exported = await send('post', `/api/didox/invoices/${ids.noisy}/export?format=receipt_xlsx`);
    assert.equal(exported.status, 409);
    assert.equal(bodyOf(exported).error.code, 'not_implemented');

    const bulk = await send('post', `/api/didox/invoices/${ids.standard}/approve`).send({ scope: 'clean' });
    matches(dx.approveMany.response, bulk.body, 'approveMany');
    assert.equal(bodyOf<{ approved: number }>(bulk).approved, 3);
    const after = bodyOf<Detail>(await http().get(`/api/didox/invoices/${ids.standard}`).set('Cookie', cookie));
    assert.equal(after.invoice.status, 'approved');
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

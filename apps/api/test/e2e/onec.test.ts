// endpoints.onec through the real app against the development database: the history and a batch,
// prepare / export / download, decisions single and bulk, the connection settings and test, the
// counterparties import, and the refusals (role, demo, scope, CSRF, another org).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { makeClient, makePerson } from '@tasnivo/domain/firm-test-fixtures';
import { seedBankBatch, seedInvoiceBatch } from '@tasnivo/domain/onec/fixtures/seed';
import { buildCounterpartiesXlsx } from '@tasnivo/domain/onec/sheets';
import { decodeBankExchange } from '@tasnivo/domain/onec/bank-exchange';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { matches, sessionCookie } from '../upload-fixtures';

const skip = await dbSkipReason();
const o = endpoints.onec;

type Detail = { batch: { id: string; status: string; exports: { id: string; hasFile: boolean }[] }; records: { id: string; status: string }[]; total: number };

describe('onec (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let owner: TestUser;
  let cookie = '';
  let clientId = '';
  let otherClient = '';
  let bankId = '';

  const http = () => request(serverOf(app));
  const get = (path: string, who = cookie) => http().get(path).set('Cookie', who);
  const send = (method: 'post' | 'put', path: string, who = cookie) => http()[method](path).set('Cookie', who).set('X-Requested-With', 'tasnivo');

  before(async () => {
    app = await startApp();
    owner = await makeUser();
    // A running trial: an ended plan refuses uploads (the counterparty import among them).
    await db.organization.update({ where: { id: owner.orgId }, data: { trialEndsAt: new Date(Date.now() + 7 * 86_400_000) } });
    orgs.push(owner.orgId);
    cookie = await sessionCookie(owner);
    clientId = await makeClient(owner.orgId, 'Mijoz bank');
    otherClient = await makeClient(owner.orgId, 'Boshqa mijoz');
    bankId = await seedBankBatch({ orgId: owner.orgId, clientId, createdBy: owner.userId }, {
      issues: { 3: [{ code: 'unresolved', severity: 'error', field: 'operation' }] },
    });
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('history and one batch, in the contract\'s shapes', async () => {
    const list = await get(`/api/onec/batches?client=${clientId}`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    matches(o.batches.response, list.body, 'batches');
    assert.equal(bodyOf<{ total: number }>(list).total, 1);
    const detail = await get(`/api/onec/batches/${bankId}?page=0`);
    assert.equal(detail.status, 200);
    matches(o.batch.response, detail.body, 'batch');
    const d = bodyOf<Detail & { formats: string[]; primary: string }>(detail);
    assert.equal(d.total, 6);
    assert.deepEqual(d.formats, ['bank_exchange_1_02', 'counterparties_xlsx']);
    const only = await get(`/api/onec/batches/${bankId}?status=unresolved`);
    assert.equal(bodyOf<Detail>(only).records.length, 1);
    assert.equal((await get('/api/onec/batches/nope')).status, 404);
  });

  it('prepare (dry run), decisions, export, download and the idempotent repeat', async () => {
    const prep = await send('post', `/api/onec/batches/${bankId}/prepare`).send({ format: 'bank_exchange_1_02' });
    assert.equal(prep.status, 200, JSON.stringify(prep.body));
    matches(o.prepare.response, prep.body, 'prepare');
    assert.equal(bodyOf<{ records: number }>(prep).records, 5);

    const d = bodyOf<Detail>(await get(`/api/onec/batches/${bankId}`));
    const unresolved = d.records.find((r) => r.status === 'unresolved')!;
    const refusedApprove = await send('put', `/api/onec/records/${unresolved.id}/decision`).send({ action: 'approve' });
    assert.equal(refusedApprove.status, 200);
    matches(o.decide.response, refusedApprove.body, 'decide refused');
    assert.equal(bodyOf<{ code: string }>(refusedApprove).code, 'has_errors');
    const corrected = await send('put', `/api/onec/records/${unresolved.id}/decision`).send({ action: 'correct', corrections: { operation: 'tax' } });
    matches(o.decide.response, corrected.body, 'decide');
    assert.equal(bodyOf<{ record: { status: string }; batchStatus: string }>(corrected).record.status, 'corrected');
    assert.equal(bodyOf<{ batchStatus: string }>(corrected).batchStatus, 'approved');

    const bulk = await send('post', `/api/onec/batches/${bankId}/decisions`).send({ recordIds: [d.records[5]!.id], decision: { action: 'skip' } });
    matches(o.decideMany.response, bulk.body, 'decideMany');
    assert.equal(bodyOf<{ count: number }>(bulk).count, 1);

    const exp = await send('post', `/api/onec/batches/${bankId}/export`).send({ format: 'bank_exchange_1_02' });
    assert.equal(exp.status, 200, JSON.stringify(exp.body));
    matches(o.exportBatch.response, exp.body, 'export');
    const built = bodyOf<{ ok: true; exportId: string; filename: string; reused: boolean }>(exp);
    assert.equal(built.filename, 'kl_to_1c.txt');
    assert.equal(built.reused, false);

    const file = await get(`/api/onec/exports/${built.exportId}/file`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'text/plain; charset=windows-1251');
    assert.match(String(file.headers['content-disposition']), /kl_to_1c\.txt/);
    const text = decodeBankExchange(file.body as Buffer);
    assert.equal((text.match(/^СекцияДокумент=/gm) ?? []).length, 5);

    const again = await send('post', `/api/onec/batches/${bankId}/export`).send({ format: 'bank_exchange_1_02' });
    assert.equal(bodyOf<{ exportId: string; reused: boolean }>(again).exportId, built.exportId);
    assert.equal(bodyOf<{ reused: boolean }>(again).reused, true);

    const after = bodyOf<Detail>(await get(`/api/onec/batches/${bankId}`));
    assert.equal(after.batch.status, 'exported');
    assert.equal(after.batch.exports.length, 1);
    assert.equal(after.batch.exports[0]?.hasFile, true);

    const none = await send('post', `/api/onec/batches/${bankId}/transfer`).send({});
    assert.equal(bodyOf<{ code: string }>(none).code, 'no_connection');
    const wrongFormat = await send('post', `/api/onec/batches/${bankId}/export`).send({ format: 'receipt_xlsx' });
    assert.equal(bodyOf<{ code: string; error: string }>(wrongFormat).code, 'format_unsupported');
    assert.ok(bodyOf<{ error: string }>(wrongFormat).error.length > 3, 'worded in the user\'s language');
    assert.equal((await send('post', `/api/onec/batches/${bankId}/export`).send({ format: 'nope' })).status, 400);
  });

  it('refusals: CSRF, viewer, demo, a scoped accountant, another org', async () => {
    assert.equal((await http().post(`/api/onec/batches/${bankId}/prepare`).set('Cookie', cookie).send({ format: 'bank_exchange_1_02' })).status, 403, 'no X-Requested-With');

    const viewer = await makePerson(owner.orgId, 'viewer');
    const viewerCookie = await sessionCookie(viewer);
    assert.equal((await get(`/api/onec/batches/${bankId}`, viewerCookie)).status, 200, 'reads are open');
    assert.equal((await send('post', `/api/onec/batches/${bankId}/export`, viewerCookie).send({ format: 'bank_exchange_1_02' })).status, 403);
    assert.equal((await get('/api/onec/connection', viewerCookie)).status, 403, 'connection is for admins');

    const scoped = await makePerson(owner.orgId, 'accountant', [otherClient]);
    const scopedCookie = await sessionCookie(scoped);
    assert.equal((await get(`/api/onec/batches/${bankId}`, scopedCookie)).status, 404);
    assert.equal(bodyOf<{ total: number }>(await get('/api/onec/batches', scopedCookie)).total, 0);
    assert.equal((await send('post', `/api/onec/batches/${bankId}/prepare`, scopedCookie).send({ format: 'bank_exchange_1_02' })).status, 404);
    const recs = bodyOf<Detail>(await get(`/api/onec/batches/${bankId}`)).records;
    assert.equal((await send('put', `/api/onec/records/${recs[0]!.id}/decision`, scopedCookie).send({ action: 'skip' })).status, 404);
    const exportId = bodyOf<Detail>(await get(`/api/onec/batches/${bankId}`)).batch.exports[0]!.id;
    assert.equal((await get(`/api/onec/exports/${exportId}/file`, scopedCookie)).status, 404);

    const stranger = await makeUser();
    orgs.push(stranger.orgId);
    const strangerCookie = await sessionCookie(stranger);
    assert.equal((await get(`/api/onec/batches/${bankId}`, strangerCookie)).status, 404);
    assert.equal((await get(`/api/onec/exports/${exportId}/file`, strangerCookie)).status, 404);

    const demo = await makeUser({ kind: 'demo', expiresAt: new Date(Date.now() + 86_400_000) });
    orgs.push(demo.orgId);
    const demoBatch = await seedInvoiceBatch({ orgId: demo.orgId });
    const demoExport = await send('post', `/api/onec/batches/${demoBatch}/export`, await sessionCookie(demo)).send({ format: 'receipt_xlsx' });
    assert.equal(demoExport.status, 403);
    assert.equal(bodyOf(demoExport).error.code, 'demo');
  });

  it('connection: save (password never answered), test against an unreachable address', async () => {
    const empty = await get('/api/onec/connection');
    assert.equal(empty.status, 200);
    matches(o.connection.response, empty.body, 'connection');
    assert.equal(bodyOf<{ kind: string }>(empty).kind, 'none');
    const bad = await send('put', '/api/onec/connection').send({ kind: 'odata', baseUrl: 'javascript:alert(1)' });
    assert.equal(bodyOf<{ code: string }>(bad).code, 'bad_url');
    const saved = await send('put', '/api/onec/connection').send({ kind: 'odata', baseUrl: 'http://127.0.0.1:9/base', username: 'u', password: 'p4ss-secret', bankKeys: 'uz_mfo' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    matches(o.saveConnection.response, saved.body, 'saveConnection');
    assert.ok(!JSON.stringify(saved.body).includes('p4ss-secret'));
    const test = await send('post', '/api/onec/connection/test').send({});
    assert.equal(test.status, 200);
    matches(o.testConnection.response, test.body, 'testConnection');
    const t = bodyOf<{ ok: boolean; code: string }>(test);
    assert.equal(t.ok, false);
    assert.match(t.code, /^unreachable|timeout/);
    const view = bodyOf<{ lastOk: boolean; bankKeys: string; verifiedAgainstReal1C: boolean }>(await get('/api/onec/connection'));
    assert.deepEqual([view.lastOk, view.bankKeys, view.verifiedAgainstReal1C], [false, 'uz_mfo', false]);
  });

  it('counterparties: load a 1C «Контрагенты» file for a client and list them', async () => {
    const file = await buildCounterpartiesXlsx([
      { name: 'ООО "Ромашка Савдо"', inn: '301234567', account: '20208000100200300401', mfo: '00444' },
      { name: 'ЧП Иванов', inn: '303456789', account: null, mfo: null },
    ]);
    const res = await send('post', '/api/onec/counterparties/import').field('clientId', clientId).attach('file', file, 'kontragenty.xlsx');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    matches(o.importCounterparties.response, res.body, 'importCounterparties');
    assert.equal(bodyOf<{ created: number }>(res).created, 2);
    const list = await get(`/api/onec/counterparties?client=${clientId}&q=ромашка`);
    matches(o.counterparties.response, list.body, 'counterparties');
    assert.equal(bodyOf<{ total: number }>(list).total, 1);
    const scoped = await makePerson(owner.orgId, 'accountant', [otherClient]);
    const denied = await send('post', '/api/onec/counterparties/import', await sessionCookie(scoped)).field('clientId', clientId).attach('file', file, 'k.xlsx');
    assert.equal(bodyOf<{ code: string }>(denied).code, 'client');
  });
});

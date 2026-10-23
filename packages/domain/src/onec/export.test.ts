// prepareExport / buildExport / transferExport, the decisions and the counterparties against the
// development database (skipped without it). Every org is a "test-" org dropped afterwards.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient } from '../firm-test-fixtures.js';
import { dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { decodeBankExchange } from './bank-exchange.js';
import { getConnection, openPassword, saveConnection, testConnection } from './connection.js';
import { buildCounterpartiesXlsx } from './sheets.js';
import { BANK_TRANSACTIONS, INVOICE_META } from './fixtures/demo-data.js';
import { seedBankBatch, seedInvoiceBatch, seedProductBatch } from './fixtures/seed.js';
import {
  batchDetail, buildExport, decideMany, decideRecord, exportFile, importCounterparties, listBatches, matchCounterparties, prepareExport,
  recordCounterparties, transferExport,
} from './index.js';

/** The database only (the classifier is not needed here). */
async function skipReason(): Promise<string | false> {
  try {
    await db.$queryRaw`SELECT 1 FROM onec_connection LIMIT 1`;
    return false;
  } catch {
    return 'database not reachable or migration 20261101000100 not applied';
  }
}
const skip = await skipReason();

const recordsOf = (batchId: string) => db.importRecord.findMany({ where: { batchId }, orderBy: { rowIndex: 'asc' } });

describe('1C exports (database)', { skip }, () => {
  const orgs: string[] = [];
  let a: TestActor;
  let clientId: string;
  const reader = () => ({ orgId: a.orgId, clientIds: null });
  const actor = () => ({ ...reader(), userId: a.userId });

  before(async () => {
    a = await makeOrg();
    orgs.push(a.orgId);
    clientId = await makeClient(a.orgId, 'Mijoz 1C');
  });
  after(async () => {
    await dropOrgs(orgs);
  });

  it('prepare reports what would go and writes nothing; build writes the file, outcomes, state and an audit event', async () => {
    const batchId = await seedBankBatch({ orgId: a.orgId, clientId, createdBy: a.userId });
    const prepared = await prepareExport({ orgId: a.orgId, batchId, format: 'bank_exchange_1_02' });
    assert.ok(prepared.ok);
    assert.equal(prepared.records, 6);
    assert.deepEqual(prepared.checks.map((c) => [c.code, c.ok]), [['balance', true], ['turnover', true], ['duplicates', true], ['review', true], ['records', true]]);
    assert.equal(await db.oneCExport.count({ where: { batchId } }), 0);

    const built = await buildExport({ orgId: a.orgId, batchId, format: 'bank_exchange_1_02', actorId: a.userId });
    assert.ok(built.ok);
    assert.equal(built.file.headers['content-type'], 'text/plain; charset=windows-1251');
    assert.match(built.file.headers['content-disposition'] ?? '', /kl_to_1c\.txt/);
    const text = decodeBankExchange(built.file.body as Uint8Array);
    assert.match(text, /Получатель=ООО «Тасниво Тест»/);
    assert.match(text, /НачальныйОстаток=12500000\.00/);

    const recs = await recordsOf(batchId);
    assert.ok(recs.every((r) => r.status === 'exported'));
    assert.ok(recs.every((r) => (r.outcome as { result: string; exportId: string }).result === 'imported' && (r.outcome as { exportId: string }).exportId === built.exportId));
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    assert.equal(batch.status, 'exported');
    assert.equal((batch.counts as { exported: number }).exported, 6);
    const row = await db.oneCExport.findUniqueOrThrow({ where: { id: built.exportId } });
    assert.equal(row.recordCount, 6);
    assert.deepEqual((row.outcome as { imported: number; skipped: number }).imported, 6);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'onec.exported', targetId: batchId } }), 1);
    const again = await exportFile(a.orgId, built.exportId);
    assert.deepEqual(again?.body, built.file.body);
    assert.equal(await exportFile(a.orgId, built.exportId, ['someone-else']), null, 'a client the reader may not open');

    // Idempotent: the same request again answers the same export, unchanged.
    const repeat = await buildExport({ orgId: a.orgId, batchId, format: 'bank_exchange_1_02', actorId: a.userId });
    assert.ok(repeat.ok);
    assert.equal(repeat.exportId, built.exportId);
    assert.equal(repeat.reused, true);
    assert.equal(await db.oneCExport.count({ where: { batchId } }), 1);

    // An explicit re-send of the same records is allowed, flagged as the same set exported before.
    const ids = recs.map((r) => r.id);
    const resend = await prepareExport({ orgId: a.orgId, batchId, format: 'bank_exchange_1_02', recordIds: ids });
    assert.ok(resend.ok);
    assert.equal(resend.records, 6);
    assert.ok(resend.issues.some((i) => i.code === 'duplicate_export' && i.severity === 'warning' && i.params?.['exportId'] === built.exportId));

    // The same statement uploaded again as another batch: every payment is already in 1C.
    const twin = await seedBankBatch({ orgId: a.orgId, clientId });
    const twinPrep = await prepareExport({ orgId: a.orgId, batchId: twin, format: 'bank_exchange_1_02' });
    assert.ok(twinPrep.ok);
    assert.equal(twinPrep.records, 0);
    assert.equal(twinPrep.issues.filter((i) => i.code === 'duplicate_export' && i.severity === 'error').length, 6);
    assert.deepEqual(await buildExport({ orgId: a.orgId, batchId: twin, format: 'bank_exchange_1_02', actorId: a.userId }), { ok: false, error: 'nothing_to_export' });
  });

  it('refusals: another org, an unknown or unsupported format, an invoice without its header', async () => {
    const other = await makeOrg();
    orgs.push(other.orgId);
    const batchId = await seedBankBatch({ orgId: a.orgId }, { transactions: BANK_TRANSACTIONS.map((t) => ({ ...t, docNumber: `x${t.docNumber}` })) });
    assert.deepEqual(await prepareExport({ orgId: other.orgId, batchId, format: 'bank_exchange_1_02' }), { ok: false, error: 'not_found' });
    assert.deepEqual(await prepareExport({ orgId: a.orgId, batchId, format: 'receipt_xlsx' }), { ok: false, error: 'format_unsupported' });
    assert.deepEqual(await prepareExport({ orgId: a.orgId, batchId, format: 'nope' as 'odata' }), { ok: false, error: 'format_unknown' });
    assert.deepEqual(await buildExport({ orgId: a.orgId, batchId, format: 'odata', actorId: a.userId }), { ok: false, error: 'format_not_file' });
    const inv = await seedInvoiceBatch({ orgId: a.orgId }, { ...INVOICE_META, externalId: 'broken', number: '', date: 'x' });
    assert.deepEqual(await prepareExport({ orgId: a.orgId, batchId: inv, format: 'receipt_xlsx' }), { ok: false, error: 'meta_invalid' });
  });

  it('review decisions: approve, correct, skip, reopen, bulk; build skips what is not approved with the reason', async () => {
    const transactions = BANK_TRANSACTIONS.map((t) => ({ ...t, docNumber: `d${t.docNumber ?? ''}` }));
    const batchId = await seedBankBatch({ orgId: a.orgId, clientId }, {
      transactions,
      issues: {
        1: [{ code: 'counterparty_unknown', severity: 'warning', field: 'counterparty' }],
        3: [{ code: 'unresolved', severity: 'error', field: 'operation' }],
        4: [{ code: 'counterparty_unknown', severity: 'warning', field: 'counterparty' }],
      },
    });
    const recs = await recordsOf(batchId);
    assert.deepEqual(recs.map((r) => r.status), ['valid', 'suspicious', 'valid', 'unresolved', 'suspicious', 'valid']);
    assert.equal((await db.importBatch.findUniqueOrThrow({ where: { id: batchId } })).status, 'review');

    const unresolved = recs[3]!.id;
    assert.deepEqual(await decideRecord(actor(), unresolved, { action: 'approve' }), { ok: false, error: 'has_errors' });
    const bad = await decideRecord(actor(), unresolved, { action: 'correct', corrections: { amount: 'lots' } });
    assert.deepEqual(bad, { ok: false, error: 'invalid_correction', field: 'amount' });
    const fixed = await decideRecord(actor(), unresolved, { action: 'correct', corrections: { operation: 'tax' }, note: 'НДС' });
    assert.ok(fixed.ok);
    assert.equal(fixed.record.status, 'corrected');
    assert.equal(fixed.record.payload['operation'], 'tax');
    assert.deepEqual(fixed.record.issues, []);

    // Before the bulk approval the suspicious ones would be left out as "not approved".
    const early = await prepareExport({ orgId: a.orgId, batchId, format: 'bank_exchange_1_02' });
    assert.ok(early.ok);
    assert.equal(early.records, 4);
    assert.equal(early.issues.find((i) => i.code === 'unresolved')?.params?.['count'], 2);

    const many = await decideMany(actor(), batchId, { recordIds: [recs[1]!.id, recs[4]!.id], decision: { action: 'approve' } });
    assert.ok(many.ok);
    assert.equal(many.count, 2);
    assert.equal(many.batchStatus, 'approved');
    const skipped = await decideRecord(actor(), recs[5]!.id, { action: 'skip' });
    assert.ok(skipped.ok);
    const reopened = await decideRecord(actor(), recs[1]!.id, { action: 'reopen' });
    assert.ok(reopened.ok);
    assert.equal(reopened.record.status, 'suspicious');
    assert.equal(reopened.batchStatus, 'review');
    assert.deepEqual(await decideMany(actor(), batchId, { recordIds: [recs[1]!.id], decision: { action: 'correct', corrections: { a: 1 } } }), { ok: false, error: 'invalid' });

    const built = await buildExport({ orgId: a.orgId, batchId, format: 'bank_exchange_1_02', actorId: a.userId });
    assert.ok(built.ok);
    const after = await recordsOf(batchId);
    const view = after.map((r) => [r.status, (r.outcome as { result: string; reason: string | null } | null)?.result, (r.outcome as { reason: string | null } | null)?.reason]);
    assert.deepEqual(view, [
      ['exported', 'imported', null], ['suspicious', 'skipped', 'not_approved'], ['exported', 'imported', null], ['exported', 'imported', null],
      ['exported', 'imported', null], ['skipped', 'skipped', 'skipped'],
    ]);
    const text = decodeBankExchange(built.file.body as Uint8Array);
    assert.ok(!/НачальныйОстаток/.test(text), 'a partial statement carries no balances');
    assert.deepEqual(await decideRecord(actor(), after[0]!.id, { action: 'skip' }), { ok: false, error: 'already_exported' });

    const detail = await batchDetail(reader(), batchId, { page: 0 });
    assert.equal(detail?.records.length, 6);
    assert.equal(detail?.batch.exports.length, 1);
    assert.equal(detail?.batch.exports[0]?.outcome?.reasons['not_approved'], 1);
    assert.equal(await batchDetail({ orgId: a.orgId, clientIds: [] }, batchId, { page: 0 }), null, 'a scoped accountant without this client');
    const list = await listBatches(reader(), { kind: 'bank_statement', client: clientId, page: 0 });
    assert.ok(list.rows.some((r) => r.id === batchId && r.clientName === 'Mijoz 1C'));
    assert.equal((await listBatches({ orgId: a.orgId, clientIds: [] }, { page: 0 })).total, 0);
  });

  it('side files leave the records alone; receipt and nomenclature from an invoice, nomenclature from a catalogue', async () => {
    const inv = await seedInvoiceBatch({ orgId: a.orgId, clientId });
    const side = await buildExport({ orgId: a.orgId, batchId: inv, format: 'nomenclature_xlsx', actorId: a.userId });
    assert.ok(side.ok);
    assert.ok((await recordsOf(inv)).every((r) => r.status === 'valid' && r.outcome === null));
    const cps = await buildExport({ orgId: a.orgId, batchId: inv, format: 'counterparties_xlsx', actorId: a.userId });
    assert.ok(cps.ok);
    const receipt = await buildExport({ orgId: a.orgId, batchId: inv, format: 'receipt_xlsx', actorId: a.userId });
    assert.ok(receipt.ok);
    assert.match(receipt.file.headers['content-disposition'] ?? '', /postuplenie/);
    assert.ok((await recordsOf(inv)).every((r) => r.status === 'exported'));
    assert.equal((await db.importBatch.findUniqueOrThrow({ where: { id: inv } })).status, 'exported');

    const prod = await seedProductBatch({ orgId: a.orgId });
    // The product without an MXIK is suspicious until approved.
    const prep = await prepareExport({ orgId: a.orgId, batchId: prod, format: 'nomenclature_xlsx' });
    assert.ok(prep.ok);
    assert.equal(prep.records, 2);
  });

  it('counterparties: ИНН, account, normalised name, alias; ambiguity; record creates and learns', async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    const ref = (name: string, inn: string | null = null, account: string | null = null) => ({ name, inn, account, mfo: null, counterpartyId: null });
    const created = await recordCounterparties(org.orgId, [ref('ООО "Ромашка"', '301234567', '20208000100200300401'), ref('ООО «Ромашка»', '301234567'), ref('ИП Петров'), ref('')], { source: 'bank_statement' });
    assert.equal(await db.counterparty.count({ where: { orgId: org.orgId } }), 2, 'one per ИНН, one by name; a blank ref is not created');
    assert.equal(created[0]?.counterpartyId, created[1]?.counterpartyId);
    assert.equal(created[3]?.match?.status, 'unknown');

    const matched = await matchCounterparties(org.orgId, [
      ref('Совсем другое имя', '301234567'), ref('X', null, '20208000100200300401'), ref('ромашка'), ref('Петров ИП'), ref('Новый'),
    ]);
    assert.deepEqual(matched.map((m) => [m.match?.status, m.match?.chosen?.basis]), [
      ['matched', 'inn'], ['matched', 'account'], ['matched', 'name_normalized'], ['matched', 'name_normalized'], ['new', undefined],
    ]);
    assert.equal(matched[0]?.match?.chosen?.confidence, 0.99);

    // Recording a matched one under another spelling learns it as an alias.
    await recordCounterparties(org.orgId, [ref('Romashka Savdo MChJ', '301234567')]);
    const alias = await matchCounterparties(org.orgId, [ref('ROMASHKA SAVDO')]);
    assert.equal(alias[0]?.match?.chosen?.basis, 'alias');

    // Two counterparties with one normalised name and different ИНН: a name-only ref is ambiguous.
    await recordCounterparties(org.orgId, [ref('ООО Ромашка', '309999999')]);
    const amb = await matchCounterparties(org.orgId, [ref('Ромашка')]);
    assert.equal(amb[0]?.match?.status, 'ambiguous');
    assert.equal(amb[0]?.counterpartyId, null);
    assert.equal(amb[0]?.match?.candidates.length, 2);
    // An ИНН that contradicts a name match is not a match; a counterparty without an ИНН does not contradict.
    const contra = await matchCounterparties(org.orgId, [ref('Ромашка', '388888888'), ref('ИП Петров', '388888888')]);
    assert.deepEqual(contra.map((c) => c.match?.status), ['new', 'matched']);
  });

  it('counterparties: a 1C «Контрагенты» export loads, and loads again without duplicates', async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    const client = await makeClient(org.orgId, 'Mijoz K');
    const file = await buildCounterpartiesXlsx([
      { name: 'ООО "Альфа"', inn: '301111111', account: '20208000100000000001', mfo: '00444', bankName: 'Банк' },
      { name: 'MChJ Beta', inn: '302222222', account: null, mfo: null },
      { name: 'Плохой ИНН', inn: '12345', account: null, mfo: null },
      { name: 'Без ИНН', inn: null, account: null, mfo: null },
    ]);
    const first = await importCounterparties(org.orgId, client, file, 'kontragenty.xlsx');
    assert.deepEqual(first, { ok: true, rows: 4, created: 3, updated: 0, skipped: 1, errors: [{ row: 3, reason: 'inn_invalid' }] });
    const second = await importCounterparties(org.orgId, client, file, 'kontragenty.xlsx');
    assert.ok(second.ok);
    assert.equal(second.created, 0);
    assert.equal(second.updated, 3);
    assert.equal(await db.counterparty.count({ where: { orgId: org.orgId, clientId: client } }), 3);
    assert.deepEqual(await importCounterparties(org.orgId, client, Buffer.from('a;b\n1;2\n'), 'x.csv'), { ok: false, error: 'no_name_column' });
  });
});

// ── A fake 1C OData server (the only 1C this build has been tested against) ─────────────────

type Seen = { method: string; url: string; auth: string | null; body: unknown };

function fakeOData(): Promise<{ server: Server; base: string; seen: Seen[]; refuseAmount: { value: number | null } }> {
  const seen: Seen[] = [];
  const refuseAmount = { value: null as number | null };
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', () => {
      const auth = req.headers.authorization ?? null;
      const url = decodeURIComponent(req.url ?? '');
      seen.push({ method: req.method ?? '', url, auth, body: raw ? JSON.parse(raw) : null });
      if (auth !== `Basic ${Buffer.from('odata:s3cret').toString('base64')}`) { res.writeHead(401).end(); return; }
      if (url.endsWith('/odata/standard.odata/$metadata')) {
        res.writeHead(200, { 'content-type': 'application/xml' }).end(
          '<edmx:Edmx><EntityContainer><EntitySet Name="Document_ПоступлениеНаРасчетныйСчет"/><EntitySet Name="Document_СписаниеСРасчетногоСчета"/><EntitySet Name="Catalog_Номенклатура"/></EntityContainer></edmx:Edmx>',
        );
        return;
      }
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      if (req.method === 'POST' && body['СуммаДокумента'] === refuseAmount.value) {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ 'odata.error': { code: '', message: { lang: 'ru', value: 'Не заполнено поле "Контрагент"' } } }));
        return;
      }
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ Ref_Key: `ref-${seen.length}`, ...body }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/base`, seen, refuseAmount });
  }));
}

describe('direct connection: settings, test and OData transfer against a fake 1C (database)', { skip }, () => {
  const orgs: string[] = [];
  let a: TestActor;
  let fake: Awaited<ReturnType<typeof fakeOData>>;

  before(async () => {
    a = await makeOrg();
    orgs.push(a.orgId);
    fake = await fakeOData();
  });
  after(async () => {
    fake.server.close();
    await dropOrgs(orgs);
  });

  it('saves the connection with the password sealed and never answered; refuses a bad URL', async () => {
    assert.deepEqual(await saveConnection(a.orgId, a.userId, { kind: 'odata', baseUrl: 'ftp://x' }), { ok: false, error: 'bad_url' });
    assert.deepEqual(await saveConnection(a.orgId, a.userId, { kind: 'odata', baseUrl: 'https://u:p@x.uz' }), { ok: false, error: 'bad_url' });
    assert.deepEqual(await saveConnection(a.orgId, a.userId, { kind: 'odata' }), { ok: false, error: 'url_required' });
    const saved = await saveConnection(a.orgId, a.userId, { kind: 'odata', baseUrl: `${fake.base}/`, username: 'odata', password: 'wrong', bankKeys: 'uz_mfo' });
    assert.ok(saved.ok);
    assert.equal(saved.connection.baseUrl, fake.base);
    assert.equal(saved.connection.hasPassword, true);
    assert.equal(saved.connection.verifiedAgainstReal1C, false);
    assert.ok(!JSON.stringify(saved.connection).includes('wrong'));
    const row = await db.oneCConnection.findUniqueOrThrow({ where: { orgId: a.orgId } });
    assert.ok(row.secret && !row.secret.includes('wrong'));
    assert.equal(openPassword(row.secret), 'wrong');
  });

  it('test: wrong password is auth_failed (nothing secret stored), right one reads $metadata', async () => {
    const failed = await testConnection(a.orgId);
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'auth_failed');
    const after = await getConnection(a.orgId);
    assert.equal(after.lastOk, false);
    assert.equal(after.lastError, 'auth_failed');

    const saved = await saveConnection(a.orgId, a.userId, { kind: 'odata', baseUrl: fake.base, username: 'odata', password: 's3cret' });
    assert.ok(saved.ok);
    assert.equal(saved.connection.lastTestedAt, null, 'new credentials forget the old verdict');
    const ok = await testConnection(a.orgId);
    assert.equal(ok.ok, true);
    assert.equal(ok.entitySets, 3);
    assert.deepEqual(ok.missing, ['Document_ПоступлениеТоваровУслуг']);
    assert.equal(fake.seen.at(-1)?.url, '/base/odata/standard.odata/$metadata');
  });

  it('transfer posts one document per payment; a refused one keeps its status and goes again on retry', async () => {
    const batchId = await seedBankBatch({ orgId: a.orgId }, { transactions: BANK_TRANSACTIONS.map((t) => ({ ...t, docNumber: `t${t.docNumber ?? ''}` })) });
    fake.refuseAmount.value = 225500;
    const before = fake.seen.length;
    const first = await transferExport({ orgId: a.orgId, batchId, format: 'odata', actorId: a.userId });
    assert.ok(first.ok);
    assert.equal(first.outcome.imported, 5);
    assert.equal(first.outcome.rejected, 1);
    assert.equal(first.outcome.reasons['onec_refused'], 1);
    const posts = fake.seen.slice(before);
    assert.equal(posts.length, 6);
    assert.ok(posts.every((p) => p.method === 'POST' && p.url.includes('/odata/standard.odata/Document_')));
    const credit = posts.find((p) => p.url.includes('ПоступлениеНаРасчетныйСчет'))?.body as Record<string, unknown>;
    assert.equal(credit['Date'], '2026-10-01T00:00:00');
    assert.equal(credit['СуммаДокумента'], 15000000);
    const recs = await recordsOf(batchId);
    const refused = recs.find((r) => (r.outcome as { result: string }).result === 'rejected');
    assert.equal(refused?.status, 'valid');
    assert.equal((refused?.outcome as { message: string }).message, 'Не заполнено поле "Контрагент"');
    assert.ok(recs.filter((r) => r.status === 'exported').every((r) => (r.outcome as { onecRef: string | null }).onecRef?.startsWith('ref-')));
    assert.equal((await db.importBatch.findUniqueOrThrow({ where: { id: batchId } })).error, 'onec_rejected:1');

    fake.refuseAmount.value = null;
    const retry = await transferExport({ orgId: a.orgId, batchId, format: 'odata', actorId: a.userId });
    assert.ok(retry.ok);
    assert.equal(retry.outcome.imported, 1);
    assert.equal(fake.seen.length, before + 7);
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    assert.equal(batch.status, 'exported');
    assert.equal(batch.error, null);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'onec.transferred' } }), 2);
  });

  it('no connection, or http: refused without a request', async () => {
    const org = await makeOrg();
    orgs.push(org.orgId);
    const batchId = await seedBankBatch({ orgId: org.orgId });
    assert.deepEqual(await transferExport({ orgId: org.orgId, batchId, format: 'odata', actorId: org.userId }), { ok: false, error: 'no_connection' });
    assert.deepEqual(await transferExport({ orgId: org.orgId, batchId, format: 'http', actorId: org.userId }), { ok: false, error: 'http_transfer_unsupported' });
  });
});

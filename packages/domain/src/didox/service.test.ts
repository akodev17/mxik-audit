// The Didox workflow on the database: upload → batches and records → duplicate refusals →
// decisions → the imported / skipped / rejected forecast; the connection and the sync against the
// local fake Didox. The product and 1C interfaces are the base-commit stubs unless a test injects.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { db } from '@tasnivo/db';
import type { UploadedFile } from '../catalog-upload.js';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { RateLimiter } from './client.js';
import { getConnection, removeConnection, saveConnection, syncIncoming, testConnection } from './connection.js';
import { FIXTURE_DIR, fakePdf, fixtureDocuments, startFakeDidox, type FakeDidox } from './fake-server.js';
import {
  approveMany, commitDidoxSheet, decideLine, exportInvoice, invoiceDetail, invoicePdf, listInvoices, prepareInvoice, removeInvoice, uploadDidoxFile,
} from './service.js';
import { guessSheetMap } from './sources.js';
import { baseStubDeps as S } from './test-deps.js';
import { invoiceLineFingerprint } from '../onec/index.js';
/** A sheet cell as text (ExcelJS cells may be rich objects). */
const cellText = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint' ? String(v) : v == null ? '' : JSON.stringify(v));


const skip = await dbSkipReason();
const raw = (name: string): Buffer => readFileSync(join(FIXTURE_DIR, name));
const fileOf = (name: string, body: Buffer): UploadedFile => ({ name, size: body.length, read: () => Promise.resolve(body) });
async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const userOf = (a: TestActor, over: Partial<CurrentUser> = {}): CurrentUser => ({ userId: a.userId, orgId: a.orgId, email: 'x@test.local', demo: false, clientId: null, role: 'admin', clientIds: null, ...over });

describe('Didox service (database)', { skip }, () => {
  let a: TestActor;
  let other: TestActor;
  let demo: TestActor;
  let admin: CurrentUser;
  let clientA = '';
  let clientB = '';
  const batches: Record<string, string> = {};

  before(async () => {
    a = await makeOrg();
    other = await makeOrg();
    // Running trials: an ended plan refuses uploads.
    await db.organization.updateMany({ where: { id: { in: [a.orgId, other.orgId] } }, data: { trialEndsAt: new Date(Date.now() + 7 * 86_400_000) } });
    demo = await makeOrg('demo', new Date(Date.now() + 86_400_000));
    admin = userOf(a);
    clientA = (await db.client.create({ data: { orgId: a.orgId, name: 'Alfa MChJ' } })).id;
    clientB = (await db.client.create({ data: { orgId: a.orgId, name: 'Beta MChJ' } })).id;
  });
  after(async () => {
    await dropOrgs([a.orgId, other.orgId, demo.orgId]);
    await db.$disconnect();
  });

  it('a zip of zips becomes one batch per invoice; the act is refused with its kind', async () => {
    const inner1 = await zipOf({ 'doc.json': raw('invoice-standard-3.json'), 'doc.pdf': fakePdf('EF-2026/0417'), 'doc.p7s': 's' });
    const inner2 = await zipOf({ 'b.json': raw('invoice-noisy.json') });
    const inner3 = await zipOf({ 'act.json': raw('act.json') });
    const zip = await zipOf({ '1.zip': inner1, '2.zip': inner2, '3.zip': inner3 });
    const res = await uploadDidoxFile(admin, 'ru', { file: fileOf('export.zip', zip), clientId: clientA }, S);
    assert.ok(res.ok && res.kind === 'documents', JSON.stringify(res));
    assert.deepEqual(res.items.map((i) => [i.entry, i.ok, i.ok ? i.lines : i.code]), [
      ['1.zip/doc.json', true, 3], ['2.zip/b.json', true, 5], ['3.zip/act.json', false, 'not_invoice'],
    ]);
    const refused = res.items[2];
    assert.ok(refused && !refused.ok);
    assert.equal(refused.error, 'Это не счёт-фактура (акт). Принимаются только счета-фактуры.');
    batches['standard'] = (res.items[0] as { batchId: string }).batchId;
    batches['noisy'] = (res.items[1] as { batchId: string }).batchId;

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batches['standard'] }, include: { records: { orderBy: { rowIndex: 'asc' } } } });
    assert.equal(batch.kind, 'didox_invoice');
    assert.equal(batch.source, 'didox_zip');
    assert.equal(batch.externalRef, '6a1f0c0e2b9d4c0012ab34cd');
    assert.equal(batch.clientId, clientA);
    assert.equal(batch.status, 'review');
    assert.match(batch.fingerprint, /^[0-9a-f]{64}$/);
    assert.deepEqual(batch.counts, { total: 3, valid: 3, corrected: 0, suspicious: 0, unresolved: 0, skipped: 0, exported: 0 });
    const meta = batch.meta as { number: string; didox: { verified: boolean; entry: string } };
    assert.equal(meta.number, 'EF-2026/0417');
    assert.equal(meta.didox.verified, false);
    assert.equal(meta.didox.entry, '1.zip/doc.json');
    // Agent 1's per-line key, so the 1C layer's duplicate checks find these lines.
    const fp = (lineNo: number): string => invoiceLineFingerprint(batch.meta as never, { lineNo });
    assert.deepEqual(batch.records.map((r) => [r.rowIndex, r.status, r.fingerprint]), [[0, 'valid', fp(1)], [1, 'valid', fp(2)], [2, 'valid', fp(3)]]);
    const cached = await db.didoxDocument.findFirstOrThrow({ where: { orgId: a.orgId, batchId: batches['standard'] } });
    assert.ok(cached.pdf && cached.pdf.length > 100);
  });

  it('the same invoice again is refused with a link to the earlier batch: same id, or same seller + number + date', async () => {
    const again = await uploadDidoxFile(admin, 'uz', { file: fileOf('doc.json', raw('invoice-standard-3.json')), clientId: clientA }, S);
    assert.ok(again.ok && again.kind === 'documents');
    const item = again.items[0];
    assert.ok(item && !item.ok);
    assert.equal(item.code, 'duplicate_invoice');
    assert.deepEqual(item.duplicateOf, { batchId: batches['standard'], number: 'EF-2026/0417', date: '2026-10-14' });

    // A re-issued file: other facturaid, one line changed, same seller, number and date.
    const doc = JSON.parse(raw('invoice-standard-3.json').toString()) as { facturaid: string; productlist: { products: Array<{ count: number }> } };
    doc.facturaid = 'another-id';
    (doc.productlist.products[0] as { count: number }).count = 41;
    const reissued = await uploadDidoxFile(admin, 'uz', { file: fileOf('re.json', Buffer.from(JSON.stringify(doc))), clientId: clientA }, S);
    assert.ok(reissued.ok && reissued.kind === 'documents');
    assert.equal((reissued.items[0] as { code: string }).code, 'duplicate_invoice');
    // An accountant of client B is refused the same, but the earlier batch (client A's) is not named (F20).
    const scopedB = userOf(a, { role: 'accountant', clientIds: [clientB] });
    const hidden = await uploadDidoxFile(scopedB, 'uz', { file: fileOf('doc.json', raw('invoice-standard-3.json')), clientId: clientB }, S);
    assert.ok(hidden.ok && hidden.kind === 'documents');
    const hiddenItem = hidden.items[0];
    assert.ok(hiddenItem && !hiddenItem.ok);
    assert.equal(hiddenItem.code, 'duplicate_invoice');
    assert.equal(hiddenItem.duplicateOf, undefined);
    assert.equal(hiddenItem.error, item.error, 'the same words, without the link');
    // Another org may hold the same invoice.
    const elsewhere = await uploadDidoxFile(userOf(other), 'uz', { file: fileOf('doc.json', raw('invoice-standard-3.json')), clientId: null }, S);
    assert.ok(elsewhere.ok && elsewhere.kind === 'documents' && elsewhere.items[0]?.ok);
  });

  it('refuses a viewer, a demo org, an archived or foreign client, an empty or unknown file', async () => {
    const f = fileOf('doc.json', raw('invoice-vat0-pinfl.json'));
    assert.deepEqual(await uploadDidoxFile(userOf(a, { role: 'viewer' }), 'ru', { file: f, clientId: clientA }, S), { ok: false, error: 'Недостаточно прав для этого действия.' });
    assert.equal((await uploadDidoxFile(userOf(demo), 'ru', { file: f, clientId: null }, S) as { error: string }).error, 'В демо-доступе нельзя загружать настоящие документы.');
    const foreign = (await db.client.create({ data: { orgId: other.orgId, name: 'X' } })).id;
    assert.equal((await uploadDidoxFile(admin, 'ru', { file: f, clientId: foreign }, S) as { ok: boolean }).ok, false);
    assert.equal((await uploadDidoxFile(userOf(a, { role: 'accountant', clientIds: [clientB] }), 'ru', { file: f, clientId: null }, S) as { ok: boolean }).ok, false, 'a scoped accountant must name a client');
    assert.equal((await uploadDidoxFile(admin, 'ru', { file: fileOf('x.json', Buffer.alloc(0)), clientId: null }, S) as { ok: boolean }).ok, false);
    assert.deepEqual(await uploadDidoxFile(admin, 'ru', { file: fileOf('x.pdf', Buffer.from('%PDF-1.4')), clientId: null }, S), { ok: false, error: 'Этот тип файла не поддерживается: загрузите .zip, .json или .xlsx.' });
  });

  it('lists the org\'s invoices with seller, number, totals and counts; a scoped accountant sees only their clients', async () => {
    const all = await listInvoices(admin, {});
    assert.equal(all.total, 2);
    const row = all.rows.find((r) => r.id === batches['noisy']);
    assert.ok(row);
    assert.deepEqual([row.number, row.sellerName, row.sellerInn, row.totalWithVat, row.clientName, row.issues, row.hasPdf], ['№ 88', 'YaTT "Karimov Anvar"', '301112223', '8093600.0768', 'Alfa MChJ', 4, false]);
    assert.equal(all.rows.find((r) => r.id === batches['standard'])?.hasPdf, true);
    const scoped = await listInvoices(userOf(a, { role: 'accountant', clientIds: [clientB] }), {});
    assert.equal(scoped.total, 0);
    assert.equal(await invoiceDetail(userOf(a, { role: 'accountant', clientIds: [clientB] }), batches['standard'] ?? ''), null);
    assert.equal(await invoiceDetail(userOf(other), batches['standard'] ?? ''), null);
  });

  it('the detail carries header, records, issues and the print form', async () => {
    const d = await invoiceDetail(admin, batches['noisy'] ?? '');
    assert.ok(d);
    assert.equal(d.verified, false);
    assert.equal(d.meta.date, '2026-10-14');
    assert.deepEqual(d.records.map((r) => r.status), ['valid', 'unresolved', 'unresolved', 'unresolved', 'suspicious']);
    assert.equal(d.records[0]?.payload.price, '892.86');
    const pdf = await invoicePdf(admin, batches['standard'] ?? '');
    assert.equal(pdf?.headers['Content-Type'], 'application/pdf');
    assert.equal(await invoicePdf(admin, batches['noisy'] ?? ''), null);
  });

  it('decisions: approve, refuse approve on an error, correct the MXIK, create new, skip, reopen; the batch follows', async () => {
    const d = await invoiceDetail(admin, batches['noisy'] ?? '');
    assert.ok(d);
    const [oil, sugar, flour, rice, tea] = d.records;
    assert.ok(oil && sugar && flour && rice && tea);
    assert.deepEqual(await decideLine(userOf(a, { role: 'viewer' }), 'ru', oil.id, { action: 'approve' }, S), { ok: false, error: 'Недостаточно прав для этого действия.' });
    assert.deepEqual((await decideLine(admin, 'ru', sugar.id, { action: 'approve' }, S) as { error: string }).error, 'Сначала выберите товар или исправьте проблему.');
    assert.equal((await decideLine(admin, 'ru', sugar.id, { action: 'correct', corrections: { mxik: '123' } }, S) as { ok: boolean }).ok, false);

    const approved = await decideLine(admin, 'ru', oil.id, { action: 'approve' }, S);
    assert.ok(approved.ok);
    assert.equal(approved.status, 'valid');
    const corrected = await decideLine(admin, 'ru', sugar.id, { action: 'correct', corrections: { mxik: '17019910001000000', product: 'new' }, note: 'checked on tasnif' }, S);
    assert.ok(corrected.ok);
    assert.equal(corrected.status, 'corrected');
    const sugarRow = await db.importRecord.findUniqueOrThrow({ where: { id: sugar.id } });
    const payload = sugarRow.payload as { mxik: string; product: { status: string }; resolved: { productId: null; mxik: string; name: string } };
    assert.equal(payload.mxik, '17019910001000000');
    assert.equal(payload.product.status, 'new');
    assert.deepEqual([payload.resolved.productId, payload.resolved.mxik, payload.resolved.name], [null, '17019910001000000', 'Сахар-песок 50 кг']);
    assert.deepEqual(sugarRow.issues, []);
    assert.deepEqual(sugarRow.decision, { action: 'correct', corrections: { mxik: '17019910001000000', product: 'new' }, note: 'checked on tasnif' });
    assert.equal(sugarRow.decidedBy, a.userId);

    assert.equal((await decideLine(admin, 'ru', flour.id, { action: 'skip' }, S) as { status: string }).status, 'skipped');
    const reopened = await decideLine(admin, 'ru', flour.id, { action: 'reopen' }, S);
    assert.ok(reopened.ok);
    assert.equal(reopened.status, 'unresolved');
    assert.equal((await db.importRecord.findUniqueOrThrow({ where: { id: flour.id } })).decision, null);
    await decideLine(admin, 'ru', flour.id, { action: 'skip' }, S);
    await decideLine(admin, 'ru', rice.id, { action: 'correct', corrections: { mxik: '10063010001000000' } }, S);
    const last = await decideLine(admin, 'ru', tea.id, { action: 'approve' }, S);
    assert.ok(last.ok);
    assert.deepEqual(last.counts, { total: 5, valid: 2, corrected: 2, suspicious: 0, unresolved: 0, skipped: 1, exported: 0, approved: 4 });
    assert.equal((await db.importBatch.findUniqueOrThrow({ where: { id: batches['noisy'] } })).status, 'approved');
  });

  it("prepare (dry run) agrees with Agent 1's prepareExport; the export builds the real receipt_xlsx", async () => {
    const p = await prepareInvoice(admin, 'ru', batches['noisy'] ?? '');
    assert.ok(p.ok);
    assert.equal(p.report.dryRun, true);
    assert.deepEqual([p.report.imported, p.report.skipped, p.report.rejected, p.report.newProducts], [4, 1, 0, 4]);
    assert.deepEqual(p.report.reasons, { skipped: 1 });
    assert.deepEqual(p.report.lines.map((l) => [l.lineNo, l.result]), [[1, 'imported'], [2, 'imported'], [3, 'skipped'], [4, 'imported'], [5, 'imported']]);
    assert.equal(p.onec.ok, true, JSON.stringify(p.onec));
    assert.equal(p.onec.records, 4, 'Agent 1 takes the same four lines');
    assert.ok(p.onec.checks?.every((c) => c.ok), JSON.stringify(p.onec.checks));
    // Agent 1 re-checks the arithmetic and finds the same line 5 (650 000 stated, 625 000 = 50 × 12 500).
    assert.deepEqual(p.onec.issues?.map((i) => [i.code, i.params?.['row'], i.params?.['actual']]), [['totals_mismatch', 5, '650000']]);

    const q = await prepareInvoice(admin, 'ru', batches['standard'] ?? '');
    assert.ok(q.ok);
    assert.deepEqual([q.report.imported, q.report.rejected, q.report.reasons], [0, 3, { not_approved: 3 }]);

    const exp = await exportInvoice(admin, 'ru', batches['noisy'] ?? '', 'receipt_xlsx');
    assert.ok(exp.ok, JSON.stringify(exp));
    assert.match(exp.file.headers['content-type'] ?? '', /spreadsheetml/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Buffer.from(exp.file.body as Uint8Array) as unknown as Parameters<typeof book.xlsx.load>[0]);
    const cells = book.worksheets.flatMap((ws) => ws.getSheetValues().flatMap((row) => (Array.isArray(row) ? row.map(cellText) : [])));
    for (const name of ['Подсолнечное масло 1л', 'Сахар-песок 50 кг', 'Рис девзира 1кг', 'Чай зелёный 100г']) assert.ok(cells.includes(name), name);
    assert.ok(!cells.includes('Мука в/с 25кг'), 'the skipped line is not in the file');
    assert.equal((await db.importBatch.findUniqueOrThrow({ where: { id: batches['noisy'] } })).status, 'exported');
    // The four lines created products (the stub matcher found none); their ids are written back.
    const lines = await db.importRecord.findMany({ where: { batchId: batches['noisy'], status: { not: 'skipped' } }, select: { payload: true } });
    assert.ok(lines.every((l) => Boolean((l.payload as { resolved: { productId: string | null } }).resolved.productId)));
    assert.equal(await db.product.count({ where: { orgId: a.orgId, source: 'didox' } }), 4);
    assert.equal((await exportInvoice(admin, 'ru', batches['standard'] ?? '', 'receipt_xlsx') as { code: string }).code, 'nothing_to_export');
  });

  it('bulk approve: "clean" approves the lines with no error or warning', async () => {
    const res = await approveMany(admin, 'ru', batches['standard'] ?? '', 'clean');
    assert.ok(res.ok);
    assert.equal(res.approved, 3);
    assert.equal(res.counts.valid, 3);
    assert.equal((await db.importBatch.findUniqueOrThrow({ where: { id: batches['standard'] } })).status, 'approved');
    const matched = await approveMany(admin, 'ru', batches['standard'] ?? '', 'matched');
    assert.ok(matched.ok && matched.approved === 0, 'nothing left undecided');
  });

  it('an ЭСФ spreadsheet: preview with guessed columns, then commit with the typed header', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ESF');
    ws.addRow(['№', 'Наименование', 'ИКПУ', 'Ед. изм.', 'Количество', 'Цена', 'Стоимость поставки', 'Ставка НДС', 'Сумма НДС', 'Стоимость с НДС']);
    ws.addRow([1, 'Гвозди 100мм', '07317001001000000', 'кг', 25, 18000, 450000, 12, 54000, 504000]);
    const body = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = await uploadDidoxFile(admin, 'ru', { file: fileOf('esf.xlsx', body), clientId: clientB }, S);
    assert.ok(preview.ok && preview.kind === 'sheet');
    assert.deepEqual(preview.preview.map, guessSheetMap(preview.preview.headers));
    assert.equal(preview.preview.map.total, 9);
    const header = { number: 'X-9', date: '2026-10-22', sellerTin: '302345678', sellerName: 'OOO Gvozd' };
    assert.equal((await commitDidoxSheet(admin, 'ru', { file: fileOf('esf.xlsx', body), clientId: clientB, map: { ...preview.preview.map, name: -1 }, header }, S) as { ok: boolean }).ok, false);
    const done = await commitDidoxSheet(admin, 'ru', { file: fileOf('esf.xlsx', body), clientId: clientB, map: JSON.stringify(preview.preview.map), header: JSON.stringify(header) }, S);
    assert.ok(done.ok, JSON.stringify(done));
    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: done.batchId } });
    assert.equal(batch.source, 'xlsx');
    assert.equal((batch.meta as { totalWithVat: string }).totalWithVat, '504000');
    assert.ok(await removeInvoice(admin, done.batchId));
    assert.equal(await db.importBatch.count({ where: { id: done.batchId } }), 0);
  });
});

describe('Didox connection and sync (database + fake Didox)', { skip }, () => {
  let a: TestActor;
  let admin: CurrentUser;
  let fake: FakeDidox;
  const TOKEN = 'org-token-abc';
  const before0 = process.env['DIDOX_API_URL'];
  const client = { limiter: new RateLimiter(0), sleep: () => Promise.resolve(), log: () => undefined };

  before(async () => {
    a = await makeOrg();
    admin = userOf(a);
    fake = await startFakeDidox({ documents: fixtureDocuments(), auth: { kind: 'token', token: TOKEN } });
    process.env['DIDOX_API_URL'] = fake.url;
  });
  after(async () => {
    if (before0 === undefined) delete process.env['DIDOX_API_URL']; else process.env['DIDOX_API_URL'] = before0;
    await fake.close();
    await dropOrgs([a.orgId]);
  });

  it('sync without a connection is refused; the token is stored sealed and never read back', async () => {
    assert.deepEqual(await syncIncoming(admin, 'ru', {}), { ok: false, error: 'Didox не подключён.' });
    assert.equal((await saveConnection(userOf(a, { role: 'accountant' }), 'ru', { kind: 'token', companyTin: '305123456', token: TOKEN }) as { ok: boolean }).ok, false, 'admin only');
    assert.deepEqual(await saveConnection(admin, 'ru', { kind: 'token', companyTin: '305123456' }), { ok: false, error: 'Введите токен Didox.' });
    assert.deepEqual(await saveConnection(admin, 'ru', { kind: 'token', companyTin: '305123456', token: TOKEN }), { ok: true });
    const row = await db.didoxConnection.findUniqueOrThrow({ where: { orgId: a.orgId } });
    assert.ok(row.tokenSealed && !row.tokenSealed.includes(TOKEN));
    const view = await getConnection(admin);
    assert.equal(view.connected, true);
    assert.equal(view.hasToken, true);
    assert.ok(!JSON.stringify(view).includes(TOKEN));
    assert.equal(view.baseUrl, fake.url);
  });

  it('test: measures (public) and one authorised list call', async () => {
    const t = await testConnection(admin, 'ru', client);
    assert.deepEqual(t, { ok: true, reachable: true, authorized: true, measures: 8 });
  });

  it('fetches new incoming invoices, caches JSON and PDF, and skips them on the next run', async () => {
    const first = await syncIncoming(admin, 'ru', {}, { client, deps: S });
    assert.ok(first.ok, JSON.stringify(first));
    assert.deepEqual([first.listed, first.imported, first.skipped, first.refused], [4, 4, 0, 0]);
    const batches = await db.importBatch.findMany({ where: { orgId: a.orgId }, select: { externalRef: true, source: true, meta: true } });
    assert.equal(batches.length, 4);
    assert.ok(batches.every((b) => b.source === 'didox_api'));
    const noisy = batches.find((b) => b.externalRef === '6a20aa11c0ffee0000000042');
    assert.equal((noisy?.meta as { didoxStatus: string; signed: boolean }).didoxStatus, '2');
    assert.equal((noisy?.meta as { signed: boolean }).signed, false);
    const docs = await db.didoxDocument.findMany({ where: { orgId: a.orgId } });
    assert.equal(docs.length, 4);
    assert.ok(docs.every((d) => d.pdf && Buffer.from(d.pdf).subarray(0, 5).toString('latin1') === '%PDF-'));
    // The 120-line invoice's measure ids were mapped through measures/all.
    const big = await db.importRecord.findFirstOrThrow({ where: { batch: { orgId: a.orgId, externalRef: '6a1f0c0e2b9d4c0012ab9999' }, rowIndex: 0 } });
    assert.equal((big.payload as { unit: string }).unit, 'упаковка');

    const second = await syncIncoming(admin, 'ru', {}, { client, deps: S });
    assert.ok(second.ok);
    assert.deepEqual([second.listed, second.imported, second.skipped], [4, 0, 4]);
    assert.equal(fake.requests.filter((r) => /^\/v1\/documents\/[^/]+$/.test(r.path)).length, 4, 'no document fetched twice');
    const conn = await db.didoxConnection.findUniqueOrThrow({ where: { orgId: a.orgId } });
    assert.ok(conn.lastSyncAt);
    assert.equal(conn.lastError, null);
  });

  it('a rejected token stops the sync and is recorded on the connection', async () => {
    await saveConnection(admin, 'ru', { kind: 'token', companyTin: '305123456', token: 'wrong' });
    const res = await syncIncoming(admin, 'ru', {}, { client, deps: S });
    assert.deepEqual(res, { ok: false, error: 'Didox не принял токен (401). Введите новый токен.' });
    assert.equal((await db.didoxConnection.findUniqueOrThrow({ where: { orgId: a.orgId } })).lastError, 'unauthorized');
    assert.ok(await removeConnection(admin));
    assert.equal((await getConnection(admin)).connected, false);
  });
});

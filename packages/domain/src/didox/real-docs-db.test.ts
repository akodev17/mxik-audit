// Real-world Didox material on the database: the scraped cabinet data in bulk against the local
// tasnif mirror, the real export ZIP end to end (upload → lines → checks), the roaming-id dedup, the
// ЭСФ template and the remembered sheet mapping, and the background sync against the fake Didox.
// Skips without a database with the classifier loaded (dbSkipReason).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import type { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import type { UploadedFile } from '../catalog-upload.js';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import { applyRules, defaultDeps, type CheckDeps } from './check.js';
import { RateLimiter } from './client.js';
import { documentErrors } from '../onec/plan.js';
import { saveConnection, startSync, syncIncoming, syncStatus, SYNC_STALL_MS, type SyncState } from './connection.js';
import { parseDidoxDocument } from './document.js';
import { FIXTURE_DIR, fixtureDocuments, startFakeDidox, type FakeDidox, type FakeDocument } from './fake-server.js';
import { mirrorFacts } from './mirror.js';
import { commitDidoxSheet, invoiceDetail, removeInvoice, uploadDidoxFile } from './service.js';
import { baseStubDeps } from './test-deps.js';

process.env['TASNIF_LIVE'] = 'false';
const skip = await dbSkipReason();
const REAL = join(FIXTURE_DIR, 'real');
const fileOf = (name: string, body: Buffer): UploadedFile => ({ name, size: body.length, read: () => Promise.resolve(body) });
const userOf = (a: TestActor): CurrentUser => ({ userId: a.userId, orgId: a.orgId, email: 'x@test.local', demo: false, clientId: null, role: 'admin', clientIds: null });
/** The stub matcher plus the real rules on the real mirror: fast, and the tax-side checks are the ones under test. */
const rulesDeps: CheckDeps = { ...baseStubDeps, rules: defaultDeps.rules };

type Cabinet = { id: string; docNo: string; date: string; partnerName: string; partnerInn: string; items: Array<{ name: string; mxik: string; tasnif: string; unit: string; qty: number; price: number; total: number }> };

/** A scraped cabinet record as the Didox document it was read from (lowercase keys; `total` is the line's delivery sum). */
const asDidox = (d: Cabinet): Record<string, unknown> => ({
  facturadoc: { facturano: d.docNo, facturadate: d.date || null }, sellertin: d.partnerInn, seller: { name: d.partnerName }, buyertin: '310529901',
  productlist: { products: d.items.map((i, n) => ({ ordno: n + 1, name: i.name, catalogcode: i.mxik, catalogname: i.tasnif, packagename: i.unit, count: i.qty, summa: i.price, deliverysum: i.total })) },
});

describe('Didox real data against the tasnif mirror (database)', { skip }, () => {
  let a: TestActor;
  let admin: CurrentUser;
  let fake: FakeDidox | null = null;
  const env0 = process.env['DIDOX_API_URL'];

  before(async () => {
    a = await makeOrg();
    await db.organization.update({ where: { id: a.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    admin = userOf(a);
  });
  after(async () => {
    if (env0 === undefined) delete process.env['DIDOX_API_URL']; else process.env['DIDOX_API_URL'] = env0;
    await fake?.close();
    await dropOrgs([a.orgId]);
    await db.$disconnect().catch(() => undefined);
  });

  // didox §7.17, §7.18, §7.21, §7.28: hundreds of real MXIK lines from a Didox cabinet; every code is in the mirror,
  // the units it binds are checked, the one scraped line whose total is not qty × price is named.
  it('bulk: 353 cabinet documents, 1 213 lines, 70 codes, checked against the mirror', async () => {
    const docs = JSON.parse(readFileSync(join(REAL, 'didox-auditor-cabinet.json'), 'utf8')) as Cabinet[];
    const outcomes = docs.map((d) => parseDidoxDocument(asDidox(d), { source: 'didox_json' }));
    const parsed = outcomes.flatMap((o) => (o.ok ? [o.invoice] : []));
    const refused = outcomes.flatMap((o) => (o.ok ? [] : [`${o.error}:${o.detail ?? ''}`]));
    // The scrape kept 145 documents without lines and 41 without a date: refused with the reason, never half-read.
    assert.equal(parsed.length, 167);
    assert.equal(refused.filter((r) => r === 'no_lines:').length + refused.filter((r) => r.startsWith('missing_header:facturadoc.facturadate')).length, 186);
    const lines = parsed.flatMap((p) => p.lines);
    assert.equal(lines.length, 1213);
    const codes = [...new Set(lines.flatMap((l) => (l.mxik ? [l.mxik] : [])))];
    assert.equal(codes.length, 70);
    const facts = await mirrorFacts(codes);
    assert.equal([...facts.values()].filter((f) => f.exists).length, 70, 'every real code exists in the mirror');
    const findings = new Map<string, number>();
    const unitCodes = new Set<string>();
    for (const inv of parsed) {
      const ruled = await applyRules(a.orgId, inv, { mirror: () => Promise.resolve(facts), today: () => '2026-10-30' });
      ruled.lines.forEach((ls, i) => ls.forEach((x) => {
        findings.set(x.code, (findings.get(x.code) ?? 0) + 1);
        if (x.code === 'unit_not_of_code') unitCodes.add(inv.lines[i]?.mxik ?? '');
      }));
    }
    // "dona" on a service code (10306…: xizmat) and on codes bound to other units; marked goods without marks.
    assert.deepEqual(Object.fromEntries(findings), { unit_not_of_code: 19, marks_missing: 12 });
    assert.ok(unitCodes.has('10306002005000000'));
    assert.equal(lines.flatMap((l) => l.issues).filter((i) => i.code === 'totals_mismatch').length, 1, 'qty 48 × 0.1 against 514 285.71');
  });

  // didox §7.14, §7.17–27, B6/B8: the real export ZIP uploaded end to end with the real rules: one batch, its line, the
  // checks, the print form; the same invoice again is refused.
  it('upload: the real export ZIP → batch → line → checks', async () => {
    const zip = readFileSync(join(REAL, 'real-export-1428.zip'));
    const res = await uploadDidoxFile(admin, 'ru', { file: fileOf('didox-1428.zip', zip), clientId: '' }, rulesDeps);
    assert.ok(res.ok && res.kind === 'documents', JSON.stringify(res));
    const [item] = res.items;
    assert.ok(item?.ok, JSON.stringify(item));
    const detail = await invoiceDetail(admin, item.batchId);
    assert.ok(detail);
    assert.deepEqual([detail.meta.number, detail.meta.date, detail.meta.currency, detail.meta.totalWithVat, detail.invoice.hasPdf], ['1428', '2025-06-30', 'UZS', '1000', true]);
    const meta = detail.meta as typeof detail.meta & { didox: { docType: string; envelope: string; totalsFrom: string; facturaId: string } };
    assert.deepEqual([meta.didox.docType, meta.didox.envelope, meta.didox.totalsFrom, meta.didox.facturaId], ['002', 'bare', 'lines', '68636ebd7dc738171cf68510']);
    const [record] = detail.records;
    assert.equal(record?.payload.mxik, '10403003014000001');
    assert.equal((record?.payload as unknown as { didox: { origin: number } }).didox.origin, 3);
    // The code exists, is active, binds "xizmat (so'm)", which "услуга (сум)" is: no rule finding on the line.
    assert.deepEqual(record?.issues.map((i) => i.code), ['product_unchecked']);
    assert.deepEqual(detail.batchIssues, []);
    const again = await uploadDidoxFile(admin, 'ru', { file: fileOf('again.zip', zip), clientId: '' }, rulesDeps);
    assert.ok(again.ok && again.kind === 'documents' && !again.items[0]?.ok && again.items[0]?.code === 'duplicate_invoice');
  });

  // didox §7.11: one invoice under two ids — the Didox doc_id (API) and the roaming facturaid (export) — is imported once.
  it('dedup: the same roaming facturaid under another Didox id is a duplicate', async () => {
    const json = { ...(JSON.parse(readFileSync(join(REAL, '01-real-export-1428.json'), 'utf8')) as Record<string, unknown>), expansion: { ordernumber: 'changed' } };
    const res = await uploadDidoxFile(admin, 'ru', { file: fileOf('other-id.json', Buffer.from(JSON.stringify({ _id: 'AAAABBBBCCCCDDDDEEEEFFFF00001111', data: json }))), clientId: '' }, baseStubDeps);
    assert.ok(res.ok && res.kind === 'documents');
    assert.deepEqual(res.items.map((i) => (i.ok ? 'ok' : i.code)), ['duplicate_invoice']);
  });

  // didox ЭСФ template (official filling instruction): every invoice of the template becomes a batch with its header from the cells;
  // another sheet's confirmed columns are remembered for the org (the bank module's BankFormat pattern).
  it('sheets: the template makes a batch per invoice; a mapped sheet is remembered by its headers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ЭСФ');
    const caption = (n: number): string => ({ 4: 'Номер СФ', 5: 'Дата СФ', 14: 'ИНН поставщика', 28: 'ИНН покупателя', 45: 'Наименование товара', 46: 'ИКПУ', 52: 'Количество', 53: 'Цена', 56: 'Стоимость поставки', 57: 'Ставка НДС', 58: 'Сумма НДС', 59: 'Стоимость с НДС' } as Record<number, string>)[n] ?? `Поле ${n}`;
    ws.addRow(Array.from({ length: 73 }, (_, i) => caption(i + 1)));
    const cells = (c: Record<number, string | number>): Array<string | number | null> => Array.from({ length: 73 }, (_, i) => c[i + 1] ?? null);
    ws.addRow(cells({ 1: 1, 4: 'TPL-1', 5: '20.10.2026', 14: '310529901', 28: '302936161', 45: 'Ноутбук', 46: '08471001001000000', 52: 1, 53: 1000, 56: 1000, 57: 12, 58: 120, 59: 1120 }));
    ws.addRow(cells({ 1: 2, 4: 'TPL-2', 5: '21.10.2026', 14: '310529901', 28: '302936161', 45: 'Монитор', 46: '08471001001000000', 52: 2, 53: 500, 56: 1000, 57: 12, 58: 120, 59: 1120 }));
    const template = Buffer.from(await wb.xlsx.writeBuffer());
    const preview = await uploadDidoxFile(admin, 'ru', { file: fileOf('esf.xlsx', template), clientId: '' }, baseStubDeps);
    assert.ok(preview.ok && preview.kind === 'sheet');
    assert.deepEqual([preview.preview.preset, preview.preview.invoices], ['didox_esf_template', 2]);
    const made = await commitDidoxSheet(admin, 'ru', { file: fileOf('esf.xlsx', template), clientId: '', map: undefined, header: undefined }, baseStubDeps);
    assert.ok(made.ok && made.batchIds?.length === 2, JSON.stringify(made));

    const plain = new ExcelJS.Workbook();
    const sheet = plain.addWorksheet('Лист1');
    sheet.addRow(['Товар (описание)', 'Кол.', 'Цена за ед.', 'Итого']);
    sheet.addRow(['Цемент М400', 10, 50000, 500000]);
    const body = Buffer.from(await plain.xlsx.writeBuffer());
    const first = await uploadDidoxFile(admin, 'ru', { file: fileOf('plain.xlsx', body), clientId: '' }, baseStubDeps);
    assert.ok(first.ok && first.kind === 'sheet');
    assert.deepEqual([first.preview.preset, first.preview.remembered], [null, false]);
    const map = { lineNo: -1, name: 0, mxik: -1, barcode: -1, packageName: -1, quantity: 1, price: 2, amount: 3, vatRate: -1, vatAmount: -1, total: -1 };
    const header = { number: 'P-1', date: '2026-10-22', sellerTin: '310529901', sellerName: 'X' };
    assert.ok((await commitDidoxSheet(admin, 'ru', { file: fileOf('plain.xlsx', body), clientId: '', map: JSON.stringify(map), header: JSON.stringify(header) }, baseStubDeps)).ok);
    const second = await uploadDidoxFile(admin, 'ru', { file: fileOf('plain-november.xlsx', body), clientId: '' }, baseStubDeps);
    assert.ok(second.ok && second.kind === 'sheet');
    assert.deepEqual([second.preview.remembered, second.preview.map], [true, map]);
  });

  // didox §1.3, B8: the sync runs in the background with dateFromUpdated, saves its state, counts a failing document in
  // `failed` and goes on, takes the header totals from the list entry, and is resumed after an interruption.
  it('sync: background run, failed counted, list totals, resumed after a restart', async () => {
    const docs: FakeDocument[] = fixtureDocuments().map((d) => (d.id === '6a1f0c0e2b9d4c0012ab34cd' ? { ...d, entry: { total_sum: 1, total_delivery_sum: 20155000, total_vat_sum: 2418600, total_delivery_sum_with_vat: 22573600 }, archive: false } : d));
    fake = await startFakeDidox({ documents: docs, auth: { kind: 'token', token: 'sync-token' }, brokenIds: ['6a20bb22c0ffee0000000077'] });
    process.env['DIDOX_API_URL'] = fake.url;
    assert.deepEqual(await saveConnection(admin, 'ru', { kind: 'token', companyTin: '305123456', token: 'sync-token' }), { ok: true });
    const options = { client: { limiter: new RateLimiter(0), sleep: () => Promise.resolve(), log: () => undefined, retries: 0 }, deps: baseStubDeps };
    const started = await startSync(admin, 'ru', { dateFromUpdated: '2026-10-01' }, options);
    assert.ok(started.ok, JSON.stringify(started));
    assert.equal(started.state.status, 'running');
    let state: SyncState | null = started.state;
    for (let i = 0; i < 600 && state?.status === 'running'; i++) { // 30 s at most: a loaded full run is slow (R-D15)
      await new Promise((r) => setTimeout(r, 50));
      state = await syncStatus(admin, options);
    }
    assert.ok(state);
    assert.deepEqual([state.status, state.listed, state.imported, state.refused, state.failed, state.dateFromUpdated], ['done', 4, 3, 0, 1, '2026-10-01']);
    assert.match(state.failures[0]?.error ?? '', /^server: .*Internal error/);
    assert.ok(fake.requests.some((r) => r.path === '/v2/documents' && r.query['dateFromUpdated'] === '2026-10-01' && r.query['doctype'] === '002,008,023'));
    const standard = await db.importBatch.findFirstOrThrow({ where: { orgId: a.orgId, externalRef: '6a1f0c0e2b9d4c0012ab34cd' }, select: { meta: true } });
    assert.equal((standard.meta as { didox: { totalsFrom: string } }).didox.totalsFrom, 'list');
    const pdfs = await db.didoxDocument.count({ where: { orgId: a.orgId, didoxId: '6a1f0c0e2b9d4c0012ab34cd', pdf: { not: null } } });
    assert.equal(pdfs, 1, 'no archive for it: the print form came from /file/true');

    // An API restart mid-run: the saved state says running, its heartbeat is old; the next status read takes it over.
    const stale = { ...state, status: 'running', heartbeatAt: new Date(Date.now() - SYNC_STALL_MS - 1_000).toISOString(), finishedAt: null };
    await db.didoxConnection.update({ where: { orgId: a.orgId }, data: { syncState: stale } });
    const resumed = await syncStatus(admin, options);
    assert.equal(resumed?.status, 'running');
    let end: SyncState | null = resumed;
    for (let i = 0; i < 600 && end?.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50));
      end = await syncStatus(admin, options);
    }
    // Everything already imported is skipped by id; the broken document fails again and is counted again.
    assert.equal(end?.status, 'done');
    assert.equal((end?.skipped ?? 0) >= 3, true, JSON.stringify(end));
    assert.equal(end?.imported, 3, 'the counters carry on from the interrupted run');
  });

  // didox §7.32, §7.13 (review 30 Oct): the sync skipped every id it had imported, status and all, so an invoice the
  // seller cancelled (or annulled by a correction) after the first sync stayed "signed" and exportable.
  it('sync: an imported invoice whose Didox status turns void is marked so, and no export takes it', async () => {
    const b = await makeOrg();
    try {
      await db.organization.update({ where: { id: b.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
      const owner = userOf(b);
      const docs: FakeDocument[] = fixtureDocuments().filter((d) => d.doctype === '002').slice(0, 1);
      const status = await startFakeDidox({ documents: docs, auth: { kind: 'token', token: 'status-token' } });
      try {
        process.env['DIDOX_API_URL'] = status.url;
        assert.deepEqual(await saveConnection(owner, 'ru', { kind: 'token', companyTin: '305123456', token: 'status-token' }), { ok: true });
        const options = { client: { limiter: new RateLimiter(0), sleep: () => Promise.resolve(), log: () => undefined, retries: 0 }, deps: baseStubDeps };
        const first = await syncIncoming(owner, 'ru', {}, options);
        assert.ok(first.ok && first.imported === 1, JSON.stringify(first));
        const batch = () => db.importBatch.findFirstOrThrow({ where: { orgId: b.orgId, externalRef: docs[0]!.id }, select: { id: true, kind: true, meta: true } });
        assert.deepEqual(documentErrors(await batch()), [], 'signed: nothing stops it');

        docs[0]!.status = '5555';
        const second = await syncIncoming(owner, 'ru', {}, options);
        assert.ok(second.ok && second.imported === 0 && second.skipped === 1, JSON.stringify(second));
        const after = await batch();
        assert.equal((after.meta as { didoxStatus: string }).didoxStatus, '5555');
        assert.deepEqual(documentErrors(after).map((i) => [i.code, i.params?.['state']]), [['didox_status_void', 'cancelled']]);
      } finally {
        await status.close();
      }
    } finally {
      await dropOrgs([b.orgId]);
    }
  });

  // didox §1.3 (review 30 Oct, R-D6): the sync read 50 pages at most and ended "done" with documents left unread.
  it('sync: a run that stops at its page limit with pages left says so', async () => {
    const c = await makeOrg();
    try {
      await db.organization.update({ where: { id: c.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
      const owner = userOf(c);
      const base = fixtureDocuments().find((d) => d.doctype === '002')!;
      const many: FakeDocument[] = Array.from({ length: 101 }, (_, i) => ({ ...base, id: `limit-${String(i).padStart(3, '0')}` }));
      const server = await startFakeDidox({ documents: many, auth: { kind: 'token', token: 'limit-token' } });
      try {
        process.env['DIDOX_API_URL'] = server.url;
        assert.deepEqual(await saveConnection(owner, 'ru', { kind: 'token', companyTin: '305123456', token: 'limit-token' }), { ok: true });
        const options = { client: { limiter: new RateLimiter(0), sleep: () => Promise.resolve(), log: () => undefined, retries: 0 }, deps: baseStubDeps, maxPages: 1 };
        const run = await syncIncoming(owner, 'ru', {}, options);
        assert.ok(run.ok && run.listed === 100, JSON.stringify(run));
        const state = (await db.didoxConnection.findUniqueOrThrow({ where: { orgId: c.orgId }, select: { syncState: true } })).syncState as SyncState;
        assert.match(state.failures.find((f) => f.id === '(list)')?.error ?? '', /^list_truncated: stopped after 1 pages/);
      } finally {
        await server.close();
      }
    } finally {
      await dropOrgs([c.orgId]);
    }
  });

  // Review 30 Oct (R-D4): seller + number + date refused a re-issue even when Didox had voided the first invoice, so the
  // valid one was never imported. A live earlier invoice still makes it a duplicate (service.test.ts asserts that).
  it('a re-issue of a voided invoice under the same number and date is imported; of a live one it is refused', async () => {
    const d = await makeOrg();
    try {
      await db.organization.update({ where: { id: d.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
      const owner = userOf(d);
      const json = JSON.parse(readFileSync(join(FIXTURE_DIR, 'invoice-standard-3.json'), 'utf8')) as Record<string, unknown>;
      const upload = (name: string, doc: unknown) => uploadDidoxFile(owner, 'ru', { file: fileOf(name, Buffer.from(JSON.stringify(doc))), clientId: '' }, baseStubDeps);
      const first = await upload('first.json', json);
      assert.ok(first.ok && first.kind === 'documents' && first.items[0]?.ok, JSON.stringify(first));
      const reissue = { ...json, facturaid: 'reissued-0000000000000001' };
      const live = await upload('reissue.json', reissue);
      assert.ok(live.ok && live.kind === 'documents');
      assert.equal((live.items[0] as { code?: string }).code, 'duplicate_invoice', 'the first one is live: a duplicate');
      // Didox voids the first one (the sync writes its status issue, R-D2): the re-issue is the invoice now.
      const batch = await db.importBatch.findFirstOrThrow({ where: { orgId: d.orgId }, select: { id: true, meta: true } });
      const meta = batch.meta as { didox: { issues: Prisma.InputJsonValue[] } };
      await db.importBatch.update({ where: { id: batch.id }, data: { meta: { ...meta, didoxStatus: '4', didox: { ...meta.didox, issues: [...meta.didox.issues, { code: 'didox_status_void', severity: 'error', field: 'didoxStatus', params: { status: '4', state: 'rejected', comment: '' } }] } } } });
      const after = await upload('reissue-again.json', reissue);
      assert.ok(after.ok && after.kind === 'documents' && after.items[0]?.ok, JSON.stringify(after));
    } finally {
      await dropOrgs([d.orgId]);
    }
  });

  // Review 30 Oct (R-D13): removing an invoice kept its cached Didox document, and the sync skips cached ids, so the
  // removed invoice never came back.
  it('sync: a removed invoice is fetched again by the next sync', async () => {
    const e = await makeOrg();
    try {
      await db.organization.update({ where: { id: e.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
      const owner = userOf(e);
      const docs: FakeDocument[] = fixtureDocuments().filter((d) => d.doctype === '002').slice(0, 1);
      const server = await startFakeDidox({ documents: docs, auth: { kind: 'token', token: 'again-token' } });
      try {
        process.env['DIDOX_API_URL'] = server.url;
        assert.deepEqual(await saveConnection(owner, 'ru', { kind: 'token', companyTin: '305123456', token: 'again-token' }), { ok: true });
        const options = { client: { limiter: new RateLimiter(0), sleep: () => Promise.resolve(), log: () => undefined, retries: 0 }, deps: baseStubDeps };
        const first = await syncIncoming(owner, 'ru', {}, options);
        assert.ok(first.ok && first.imported === 1, JSON.stringify(first));
        assert.ok(await removeInvoice(owner, first.batchIds[0]!));
        const again = await syncIncoming(owner, 'ru', {}, options);
        assert.ok(again.ok && again.imported === 1, JSON.stringify(again));
      } finally {
        await server.close();
      }
    } finally {
      await dropOrgs([e.orgId]);
    }
  });
});


import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { db } from '@tasnivo/db';
import { i18nFor } from '@tasnivo/i18n/locale';
import {
  catalogDiffCsv, catalogExport, catalogImportIssuesCsv, catalogReportCsv, catalogReportPdf, demoExportRefused, docTemplate, purchaseTemplate, sharePdf, XLSX_TYPE,
} from './catalog-exports.js';
import { applyMapping, storeCatalog } from './catalog-import.js';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import { fontDir } from './pdf/report-pdf.js';
import type { CurrentUser } from './session.js';
import { parseUpload } from './spreadsheet.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();

async function headerRow(body: Uint8Array | string): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(body as Uint8Array) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return (workbook.worksheets[0]?.getRow(1).values as unknown[]).slice(1).map(String);
}

describe('templates and fonts (no database)', () => {
  it('the blank templates carry the requester\'s headers and file name', async () => {
    for (const locale of ['uz', 'ru'] as const) {
      const words = i18nFor(locale).ta.importX.templates;
      const purchases = await purchaseTemplate(locale);
      assert.equal(purchases.headers['content-type'], XLSX_TYPE);
      assert.match(purchases.headers['content-disposition'] ?? '', /^attachment; /);
      assert.deepEqual(await headerRow(purchases.body), [...words.purchases.headers]);
      assert.deepEqual(await headerRow((await docTemplate(locale, 'sales')).body), [...words.sales.headers]);
      assert.deepEqual(await headerRow((await docTemplate(locale, 'cheques')).body), [...words.cheques.headers]);
    }
  });

  it('fontDir finds the DejaVu fonts from a folder below the one that has node_modules', () => {
    assert.match(fontDir(), /dejavu-fonts-ttf[\\/]ttf$/);
    assert.equal(fontDir(`${process.cwd()}/packages/domain/src`), fontDir());
  });
});

describe('downloads: refusals (database)', { skip }, () => {
  const orgs: string[] = [];
  let admin: CurrentUser;
  let stranger: CurrentUser;
  let ready = '';
  let uploaded = '';

  before(async () => {
    const org = await makeOrg();
    const other = await makeOrg();
    orgs.push(org.orgId, other.orgId);
    admin = { ...(await makePerson(org.orgId, 'admin')), demo: false, clientId: null };
    stranger = { ...(await makePerson(other.orgId, 'admin')), demo: false, clientId: null };
    const clientId = await makeClient(org.orgId, 'Mijoz');
    ready = (await makeClientCatalog(org.orgId, clientId, [{ name: 'Guruch', findings: [{ type: 'MISMATCH' }] }])).catalogId;
    uploaded = (await makeClientCatalog(org.orgId, clientId, [{ name: 'Non', findings: [] }], { status: 'uploaded' })).catalogId;
  });
  after(async () => {
    delete process.env['BILLING_REQUIRED_FOR_EXPORT'];
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('404 for none or another org\'s, 409 before the audit finished, 400 for the report downloads without an id', async () => {
    const pdf = { audience: 'internal' as const, download: false };
    for (const [d, status] of [
      [await catalogExport(stranger, 'uz', ready, null), 404], [await catalogExport(admin, 'uz', null, null), 404],
      [await catalogExport(admin, 'uz', uploaded, 'xlsx'), 409],
      [await catalogDiffCsv(stranger, 'uz', ready, null), 404], [await catalogDiffCsv(admin, 'uz', ready, null), 404],
      [await catalogReportCsv(stranger, 'uz', ready), 404], [await catalogReportCsv(admin, 'uz', null), 400], [await catalogReportCsv(admin, 'uz', uploaded), 409],
      [await catalogReportPdf(stranger, 'uz', ready, pdf), 404], [await catalogReportPdf(admin, 'uz', uploaded, pdf), 409],
      [await sharePdf('no-such-token', 'uz'), 404],
    ] as const) {
      assert.equal(d.ok, false);
      if (!d.ok) assert.equal(d.status, status, d.message);
    }
  });

  it('402 while exports wait for payment; the files when they do not', async () => {
    process.env['BILLING_REQUIRED_FOR_EXPORT'] = 'true';
    const locked = await catalogExport(admin, 'uz', ready, 'xlsx');
    assert.deepEqual(locked.ok ? null : [locked.status, locked.code], [402, 'payment_required']);
    delete process.env['BILLING_REQUIRED_FOR_EXPORT'];
    const csv = await catalogReportCsv(admin, 'uz', ready);
    assert.ok(csv.ok);
    assert.equal(csv.file.headers['cache-control'], 'private, no-store');
    const pdf = await catalogReportPdf(admin, 'ru', ready, { audience: 'client', download: true });
    assert.ok(pdf.ok);
    assert.match(pdf.file.headers['content-disposition'] ?? '', /^attachment; /);
  });

  it('under BILLING_REQUIRED_FOR_EXPORT the client PDF and the diff CSV wait for payment; the internal PDF and the report CSV leave out the chosen codes (D3)', async () => {
    const [suggested, chosen] = await liveCodes(2);
    assert.ok(suggested && chosen);
    const [findingId] = (await db.finding.findMany({ where: { item: { catalogId: ready } }, select: { id: true } })).map((f) => f.id);
    await db.finding.update({ where: { id: findingId }, data: { suggestedMxik: suggested, decision: 'accepted', chosenMxik: chosen, decidedAt: new Date() } });
    const csvText = (d: Awaited<ReturnType<typeof catalogReportCsv>>) => (d.ok ? String(d.file.body) : '');

    process.env['BILLING_REQUIRED_FOR_EXPORT'] = 'true';
    try {
      for (const d of [
        await catalogReportPdf(admin, 'uz', ready, { audience: 'client', download: true }),
        await catalogDiffCsv(admin, 'uz', ready, null),
        await catalogExport(admin, 'uz', ready, '1c'),
      ]) assert.deepEqual(d.ok ? null : [d.status, d.code], [402, 'payment_required']);
      const pdf = await catalogReportPdf(admin, 'uz', ready, { audience: 'internal', download: true });
      assert.ok(pdf.ok, 'the internal PDF is still there');
      const lockedCsv = csvText(await catalogReportCsv(admin, 'uz', ready));
      assert.match(lockedCsv, new RegExp(suggested), 'the suggestion is still shown');
      assert.doesNotMatch(lockedCsv, new RegExp(chosen), 'the chosen code is not');

      // Paid for: everything, with the chosen code.
      await db.order.create({ data: { orgId: admin.orgId, catalogId: ready, planId: 'catalog_500', amount: 700_000, status: 'paid', paidAt: new Date(), provider: 'bank' } });
      assert.match(csvText(await catalogReportCsv(admin, 'uz', ready)), new RegExp(chosen));
      assert.ok((await catalogReportPdf(admin, 'uz', ready, { audience: 'client', download: true })).ok);
      const diff = await catalogDiffCsv(admin, 'uz', ready, null);
      assert.equal(diff.ok ? 200 : diff.status, 404, 'past the payment gate: nothing to compare');
    } finally {
      delete process.env['BILLING_REQUIRED_FOR_EXPORT'];
      await db.order.deleteMany({ where: { orgId: admin.orgId } });
    }
    assert.match(csvText(await catalogReportCsv(admin, 'uz', ready)), new RegExp(chosen), 'without the flag nothing is held back');
  });

  it('every file row is exported in file order: no name and a failed check say "not checked", never clean (F7)', async () => {
    const [code = ''] = await liveCodes(1);
    const x = i18nFor('uz').ta.importX.exp;
    const text = ['Nomi;MXIK;Birlik;Izoh', `Guruch;${code};kg;birinchi`, ';12345;dona;jami 1', `Shakar;${code};kg;ikkinchi`, ';;;faqat izoh', ''].join('\n');
    const parsed = await parseUpload(Buffer.from(text, 'utf8'), 'f7.csv');
    const clientId = await makeClient(admin.orgId, 'F7 mijoz');
    const mapping = { name: 0, barcode: -1, mxik: 1, unit: 2, price: -1, sales: -1, tnved: -1 };
    const { catalogId } = await storeCatalog({ orgId: admin.orgId, userId: admin.userId, clientId, filename: 'f7.csv', parsed, mapping });
    assert.deepEqual(await applyMapping(admin.orgId, catalogId, mapping), { rows: 2, skipped: 2 });
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'ready' } });
    await db.catalogItem.updateMany({ where: { catalogId, rowIndex: 2 }, data: { checkError: 'timeout: classifier' } });

    const xlsx = await catalogExport(admin, 'uz', catalogId, 'xlsx');
    assert.ok(xlsx.ok);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsx.file.body as Uint8Array) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    assert.ok(sheet);
    const head = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
    const status = head.indexOf(x.columns.status);
    const line = (r: number): string[] => Array.from({ length: head.length }, (_, i) => sheet.getRow(r).getCell(i + 1).text);
    assert.equal(sheet.rowCount, 5, 'the header and all four file rows');
    assert.deepEqual([2, 3, 4, 5].map((r) => line(r)[3]), ['birinchi', 'jami 1', 'ikkinchi', 'faqat izoh'], 'in file order');
    assert.deepEqual(line(3).slice(0, 4), ['', '12345', 'dona', 'jami 1'], 'a row without a name goes out as it came');
    assert.equal(line(3)[status], x.notChecked.noName);
    assert.equal(line(5)[status], x.notChecked.noName);
    assert.equal(line(4)[status], x.notChecked.failed, 'a failed check is not "no risk"');
    assert.equal(line(4)[1], code, 'and keeps its code');
    assert.equal(line(2)[status], x.status.ok);

    const oneC = await catalogExport(admin, 'ru', catalogId, '1c');
    assert.ok(oneC.ok);
    const csvRows = Buffer.from(oneC.file.body as Uint8Array).toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    const ru = i18nFor('ru').ta.importX.exp.notChecked;
    assert.equal(csvRows.length, 5, 'the 1C file has every row too');
    assert.match(csvRows[2] ?? '', new RegExp(ru.noName));
    assert.match(csvRows[3] ?? '', new RegExp(ru.failed));
    const logged = await db.auditEvent.findFirstOrThrow({ where: { targetId: catalogId, action: 'catalog.exported' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([(logged.payload as { skippedRows: number }).skippedRows, (logged.payload as { failedRows: number }).failedRows], [2, 1]);
  });

  it('the import issues CSV: every file row under the current mapping, scoped like the other downloads', async () => {
    const text = 'Nomi;MXIK;Birlik\nGuruch;6301001001000000;kg\n;123;dona\nGuruch;6301001001000000;kg\n';
    const parsed = await parseUpload(Buffer.from(text, 'utf8'), 'xatolar.csv');
    const clientId = await makeClient(admin.orgId, 'CSV mijoz');
    const mapping = { name: 0, barcode: -1, mxik: 1, unit: 2, price: -1, sales: -1, tnved: -1 };
    const { catalogId } = await storeCatalog({ orgId: admin.orgId, userId: admin.userId, clientId, filename: 'xatolar.csv', parsed, mapping });
    const labels = i18nFor('uz').ta.importX.issuesCsv;
    const read = async (): Promise<string> => {
      const d = await catalogImportIssuesCsv(admin, 'uz', catalogId);
      assert.ok(d.ok);
      assert.equal(d.file.headers['content-type'], 'text/csv; charset=utf-8');
      assert.match(d.file.headers['content-disposition'] ?? '', new RegExp(`xatolar-${labels.file}\\.csv`));
      return String(d.file.body);
    };
    const before = await read();
    assert.match(before, new RegExp(labels.reasons.noName));
    assert.match(before, new RegExp(labels.reasons.lostZero));
    await applyMapping(admin.orgId, catalogId, mapping);
    assert.equal(await read(), before, 'the same report once committed: the skipped row is still read');
    for (const d of [await catalogImportIssuesCsv(stranger, 'uz', catalogId), await catalogImportIssuesCsv(admin, 'uz', null)]) {
      assert.equal(d.ok ? 200 : d.status, 404);
    }
  });

  it('a demo org runs out of downloads; a customer never does', async () => {
    assert.equal(await demoExportRefused(admin.orgId), false);
    const demo = await makeOrg('demo', new Date(Date.now() + 3_600_000));
    orgs.push(demo.orgId);
    let refused = false;
    for (let i = 0; i < 50 && !refused; i++) refused = await demoExportRefused(demo.orgId);
    assert.equal(refused, true);
  });
});

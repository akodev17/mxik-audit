// The catalogue import end to end on the documented-layout files (fixtures/make-fixtures.ts) with a
// fake Tasnif client that answers the cards and barcodes tasnif.soliq.uz answered on 2026-10-30:
// commit → background check → review → save → 1C file. Needs the dev database with the classifier
// (skipped otherwise). Each case names its research checklist item (products §7, onec §8).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { db } from '@tasnivo/db';
import type { CurrentUser } from '../session.js';
import { dbSkipReason, dropOrgs, makeOrg } from '../test-fixtures.js';
import { readCard, useTasnifClient } from './tasnif-client.js';
import { applyProductBatch, commitProductImport, decideProductRecord, exportProductBatch, previewProductImport, productBatchView, settleBatch } from './import.js';
import { FakeTasnifClient, RECORDED_CARDS, tasnifSample } from './test-fixtures.js';

const skip = await dbSkipReason();

const fixture = (file: string, name = file) => {
  const bytes = readFileSync(new URL(`./fixtures/${file}`, import.meta.url));
  return { name, size: bytes.length, read: () => Promise.resolve(bytes) };
};
const csv = (name: string, lines: string[][]) => {
  const bytes = Buffer.from(`${String.fromCharCode(0xfeff)}${lines.map((l) => l.join(';')).join('\r\n')}`, 'utf8');
  return { name, size: bytes.length, read: () => Promise.resolve(bytes) };
};

describe('catalogue import on documented layouts (database, recorded Tasnif answers)', { skip }, () => {
  let user: CurrentUser;
  const fake = new FakeTasnifClient();
  before(async () => {
    const org = await makeOrg('internal');
    user = { userId: org.userId, orgId: org.orgId, email: 'x@test.local', demo: false, clientId: null, role: 'admin', clientIds: null };
    for (const code of RECORDED_CARDS) {
      const card = readCard(tasnifSample(`by_mxik_${code}`), code);
      if (card) fake.cards.set(code, card);
    }
    useTasnifClient(fake);
  });
  after(async () => {
    useTasnifClient(null);
    await db.packagingCode.deleteMany({ where: { mxikCode: { in: [...RECORDED_CARDS] } } });
    await db.mxikCodeState.deleteMany({ where: { code: { in: [...RECORDED_CARDS] } } });
    if (user) await dropOrgs([user.orgId]);
  });

  async function importFile(file: ReturnType<typeof fixture>, clearEmpty = false) {
    const preview = await previewProductImport(user, 'ru', { file, clientId: null });
    assert.ok(preview.ok, JSON.stringify(preview));
    const commit = await commitProductImport(user, 'ru', { file, clientId: null, mapping: JSON.stringify(preview.mapping), clearEmpty });
    assert.ok(commit.ok, JSON.stringify(commit));
    await settleBatch(commit.batchId);
    const view = await productBatchView(user, commit.batchId, {});
    assert.ok(view);
    assert.equal(view.batch.status, 'review', view.batch.error ?? '');
    return { batchId: commit.batchId, view };
  }

  it('checks a UZ Cyrillic file against the real cards and hands a Cyrillic-named 1C file over', async () => {
    const { batchId, view } = await importFile(fixture('uz-cyrillic.xlsx', 'Товары.xlsx'));
    const [lactel, butterBox, petFood, repeat] = view.records;
    // products §7.7: the brand code's 40-pack box on the base code, against the freshly fetched list.
    assert.ok(butterBox?.issues.some((i) => i.code === 'package_not_of_code' && i.severity === 'error'), JSON.stringify(butterBox?.issues));
    assert.equal(butterBox?.status, 'unresolved');
    // products §7.19: the pet food price had three decimals; §7.17: the last row repeats the first.
    assert.ok(petFood?.issues.some((i) => i.code === 'price_precision'));
    assert.ok(repeat?.issues.some((i) => i.code === 'duplicate_row'));
    // products §7.12: the package name is the card's own text.
    assert.equal(lactel?.payload.packageName, 'шт. (упаковка) 200 грамм');
    assert.ok(!lactel?.issues.some((i) => i.severity === 'error'), JSON.stringify(lactel?.issues));
    const applied = await applyProductBatch(user, batchId, 'ru');
    assert.ok(applied.ok);
    const saved = await db.product.findFirstOrThrow({ where: { orgId: user.orgId, name: 'Сариёғ Lactel 200 г' } });
    assert.equal(saved.price?.toFixed(2), '28500.00');
    assert.equal(saved.priceIncludesVat, true);
    assert.equal(saved.vatRate, '12');
    // B8: the hand-over answers the UTF-8 file name, not the ASCII fallback.
    const handover = await exportProductBatch(user, batchId, 'ru');
    assert.ok(handover.ok, JSON.stringify(handover));
    assert.equal(handover.filename, 'Товары-nomenklatura.xlsx');
  });

  it('flags a brand code that exists for the barcode, and the base mismatch, from the classifier copy', async () => {
    // products §7.4, §7.5, §7.3: Uzum rows — base code with the Lactel GTIN, sugar code with the Lactel GTIN.
    const { view } = await importFile(fixture('uzum-seller.xlsx'));
    const set = view.records[3];
    const plain = view.records[4];
    assert.ok(set?.issues.some((i) => i.code === 'mxik_base_mismatch' && i.severity === 'error'), JSON.stringify(set?.issues));
    assert.ok(plain?.issues.some((i) => i.code === 'gtin_brand_code_exists' && i.suggestion === '00405001001106002'), JSON.stringify(plain?.issues));
    assert.equal(fake.calls.gtin, 0, 'every barcode was found in the classifier copy: tasnif was not asked');
  });

  it('keeps saved values on an empty cell unless the importer opts in, and writes the Артикул to 1C', async () => {
    // products §7.30, B7.
    const first = await importFile(fixture('onec-nomenclature.xlsx'));
    // The matcher doubts the transport line's name against its code: a reviewer confirms the code.
    const transport = first.view.records.find((r) => r.payload.mxik === '10112008001000001');
    assert.equal(transport?.status, 'suspicious');
    const confirmed = await decideProductRecord(user, first.batchId, transport?.id ?? '', { action: 'set_code', code: '10112008001000001' }, 'ru');
    assert.ok(confirmed.ok && confirmed.record.status === 'corrected', JSON.stringify(confirmed));
    assert.ok((await applyProductBatch(user, first.batchId, 'ru')).ok);
    // The 1C row matched the product the first case saved (same barcode): that product now has the article.
    const { id } = await db.product.findFirstOrThrow({ where: { orgId: user.orgId, article: 'LAC-200' }, select: { id: true } });
    const lactel = () => db.product.findUniqueOrThrow({ where: { id } });
    assert.equal((await lactel()).article, 'LAC-200');
    // Two different files (the same bytes would be the same batch): the second adds a row.
    const update = (name: string, extra: string[][] = []) => csv(name, [['Наименование', 'Артикул', 'Код из классификатора', 'Единица измерения'], ['Масло Lactel 200 г', '', '', 'шт'], ...extra]);
    const keep = await importFile(update('update-keep.csv'));
    assert.ok((await applyProductBatch(user, keep.batchId, 'ru')).ok);
    assert.equal((await lactel()).article, 'LAC-200', 'an empty cell kept the article');
    assert.equal((await lactel()).mxik?.trim(), '00405001001106002', 'and the code');
    const clear = await importFile(update('update-clear.csv', [['Масло Lactel 400 г', 'LAC-400', '', 'шт']]), true);
    assert.ok((await applyProductBatch(user, clear.batchId, 'ru')).ok);
    assert.equal((await lactel()).article, null, 'opted in: the mapped empty column cleared it');
    // The 1C file of the first import carries the articles (B7) and puts the service on «Услуги» (onec §8.10).
    const handover = await exportProductBatch(user, first.batchId, 'ru');
    assert.ok(handover.ok, JSON.stringify(handover));
    const file = await db.oneCExport.findUniqueOrThrow({ where: { id: handover.exportId }, select: { file: true } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(file.file ?? new Uint8Array()) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const goods: unknown[] = [];
    wb.getWorksheet('Номенклатура')?.eachRow((r, n) => { if (n > 1) goods.push(r.getCell(6).value); });
    assert.ok(goods.includes('LAC-200'), JSON.stringify(goods));
    assert.equal(wb.getWorksheet('Услуги')?.getCell('A2').value, 'Перевозка международная');
  });
});

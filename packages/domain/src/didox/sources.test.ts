import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { zipWithinLimits } from '../security/zip-guard.js';
import { parseDidoxDocument } from './document.js';
import { FIXTURE_DIR, fakePdf } from './fake-server.js';
import { guessSheetMap, readDidoxUpload, sheetToDocument } from './sources.js';

const raw = (name: string): Buffer => readFileSync(join(FIXTURE_DIR, name));

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('Didox upload sources', () => {
  it('walks a zip of zips: one inner zip per document with JSON, PDF, .p7s and a readme', async () => {
    const pdf = fakePdf('EF-2026/0417');
    const inner1 = await zipOf({ 'doc.json': raw('invoice-standard-3.json'), 'doc.pdf': pdf, 'doc.json.p7s': 'sig', 'readme.txt': 'hi' });
    const inner2 = await zipOf({ '6a20bb22.json': raw('invoice-vat0-pinfl.json'), '6a20bb22.p7s': 'sig' });
    const inner3 = await zipOf({ 'act.json': raw('act.json') });
    const outer = await zipOf({ 'inv-1.zip': inner1, 'inv-2.zip': inner2, 'act.zip': inner3, 'readme.md': '#', 'notes.docx': 'x' });
    const read = await readDidoxUpload(outer, 'didox-export.zip');
    assert.equal(read.kind, 'documents');
    if (read.kind !== 'documents') return;
    assert.deepEqual(read.documents.map((d) => [d.entry, d.kind, d.pdf ? d.pdf.length : null]), [
      ['inv-1.zip/doc.json', 'invoice', pdf.length],
      ['inv-2.zip/6a20bb22.json', 'invoice', null],
      ['act.zip/act.json', 'act', null],
    ]);
    assert.deepEqual(read.skipped, [{ entry: 'notes.docx', reason: 'not_json' }]);
  });

  it('a flat archive works too, and stray JSON that is no document is skipped', async () => {
    const zip = await zipOf({ 'a/one.json': raw('invoice-noisy.json'), 'a/one.pdf': fakePdf('88'), 'meta.json': '{"version":1}', 'bad.json': '{oops' });
    const read = await readDidoxUpload(zip, 'x.zip');
    assert.ok(read.kind === 'documents');
    assert.equal(read.documents.length, 1);
    assert.ok(read.documents[0]?.pdf);
    assert.deepEqual(read.skipped.map((s) => s.reason).sort(), ['not_document', 'unreadable_json']);
  });

  it('refuses an archive with no documents, and a third nesting level', async () => {
    assert.deepEqual(await readDidoxUpload(await zipOf({ 'readme.txt': 'x' }), 'x.zip'), { kind: 'error', error: 'no_documents' });
    const deep = await zipOf({ 'a.zip': await zipOf({ 'b.zip': await zipOf({ 'c.json': raw('invoice-standard-3.json') }) }) });
    const read = await readDidoxUpload(deep, 'deep.zip');
    assert.deepEqual(read, { kind: 'error', error: 'no_documents' });
  });

  it('a zip of zips shares one budget across levels: many small inner archives are refused as too large (Phase C F6)', async () => {
    const KB = 1024;
    // Each inner archive inflates to about 45 KB, within a 100 KB budget on its own; three of them together are not.
    const inner = (fill: number) => zipOf({ 'doc.json': raw('invoice-standard-3.json'), 'pad.txt': Buffer.alloc(40 * KB, fill) });
    const outer = await zipOf({ 'a.zip': await inner(1), 'b.zip': await inner(2), 'c.zip': await inner(3) });
    const bytes = { maxEntries: 5_000, maxTotalBytes: 100 * KB };
    assert.equal(await zipWithinLimits(await inner(1), bytes), true, 'one inner archive alone fits');
    assert.deepEqual(await readDidoxUpload(outer, 'bomb.zip', bytes), { kind: 'error', error: 'zip_limits' });
    // The entry count is one budget too: 3 outer + 3 × 2 inner entries, while no archive alone has more than 3.
    assert.deepEqual(await readDidoxUpload(outer, 'many.zip', { maxEntries: 5, maxTotalBytes: 100 * 1024 * KB }), { kind: 'error', error: 'zip_limits' });
    // Within the budget the same archive reads as before.
    const read = await readDidoxUpload(outer, 'fine.zip', { maxEntries: 5_000, maxTotalBytes: 1024 * KB });
    assert.equal(read.kind, 'documents');
    if (read.kind === 'documents') assert.deepEqual(read.documents.map((d) => d.entry), ['a.zip/doc.json', 'b.zip/doc.json', 'c.zip/doc.json']);
  });

  it('past 500 documents the rest are listed as skipped, never cut silently', async () => {
    // Review 30 Oct: a zip of 600 JSONs and a 600-item array both gave 500 documents and "0 skipped".
    const doc = raw('invoice-standard-3.json');
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 503; i++) files[`d${String(i).padStart(3, '0')}.json`] = doc;
    const zipped = await readDidoxUpload(await zipOf(files), 'many.zip');
    assert.ok(zipped.kind === 'documents');
    assert.deepEqual([zipped.documents.length, zipped.skipped.map((s) => s.reason)], [500, ['too_many_documents', 'too_many_documents', 'too_many_documents']]);
    const one = JSON.parse(doc.toString('utf8')) as unknown;
    const array = await readDidoxUpload(Buffer.from(JSON.stringify(Array.from({ length: 502 }, () => one))), 'many.json');
    assert.ok(array.kind === 'documents');
    assert.deepEqual([array.documents.length, array.skipped.map((s) => [s.entry, s.reason])], [500, [['many.json[500]', 'too_many_documents'], ['many.json[501]', 'too_many_documents']]]);
  });

  it('a single JSON (with BOM), a JSON array, and junk', async () => {
    const one = await readDidoxUpload(Buffer.concat([Buffer.from('\uFEFF'), raw('invoice-standard-3.json')]), 'doc.json');
    assert.ok(one.kind === 'documents' && one.documents.length === 1);
    const many = await readDidoxUpload(Buffer.from(JSON.stringify([JSON.parse(raw('invoice-standard-3.json').toString()), { x: 1 }])), 'docs.json');
    assert.ok(many.kind === 'documents');
    assert.equal(many.documents.length, 1);
    assert.deepEqual(many.skipped, [{ entry: 'docs.json[1]', reason: 'not_document' }]);
    assert.deepEqual(await readDidoxUpload(Buffer.from('hello'), 'x.pdf'), { kind: 'error', error: 'unsupported' });
    assert.deepEqual(await readDidoxUpload(Buffer.alloc(0), 'x.json'), { kind: 'error', error: 'empty' });
  });

  it('an ЭСФ spreadsheet: columns guessed from Russian headers, header typed by the user, same parser', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ЭСФ');
    ws.addRow(['Счёт-фактура № 15 от 20.10.2026']);
    ws.addRow(['№', 'Наименование товаров (услуг)', 'Идентификационный код и название по Единому электронному национальному каталогу', 'Единица измерения', 'Количество', 'Цена', 'Стоимость поставки', 'НДС ставка', 'НДС сумма', 'Стоимость поставки с учетом НДС']);
    ws.addRow([1, 'Цемент М400 50кг', '02523001001000000', 'мешок', 10, 62000, 620000, 12, 74400, 694400]);
    ws.addRow([2, 'Гвозди 100мм', '07317001001000000', 'кг', 25, 18000, 450000, 12, 54000, 504000]);
    ws.addRow(['', 'Итого', '', '', '', '', 1070000, '', 128400, 1198400]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const read = await readDidoxUpload(buffer, 'esf.xlsx');
    assert.equal(read.kind, 'xlsx');
    if (read.kind !== 'xlsx') return;
    const map = guessSheetMap(read.sheet.headers);
    assert.deepEqual(map, { lineNo: 0, name: 1, mxik: 2, barcode: -1, packageName: 3, quantity: 4, price: 5, amount: 6, vatRate: 7, vatAmount: 8, total: 9 });
    const doc = sheetToDocument(read.sheet, map, { number: '15', date: '2026-10-20', sellerTin: '302345678', sellerName: 'OOO Test' });
    const parsed = parseDidoxDocument(doc, { source: 'xlsx' });
    assert.ok(parsed.ok);
    assert.equal(parsed.invoice.lines.length, 2, 'the totals row is not a line');
    assert.deepEqual(parsed.invoice.lines.map((l) => [l.mxik, l.packageName, l.quantity, l.total]), [['02523001001000000', 'мешок', '10', '694400'], ['07317001001000000', 'кг', '25', '504000']]);
    assert.equal(parsed.invoice.meta.totalWithVat, '1198400');
  });

  it('guesses Uzbek headers', () => {
    const map = guessSheetMap(['T/r', 'Tovar nomi', 'MXIK', 'Oʻlchov birligi', 'Miqdori', 'Narxi', 'Yetkazib berish qiymati', 'QQS stavkasi %', 'QQS summasi', 'QQS bilan qiymati']);
    assert.deepEqual([map.name, map.mxik, map.packageName, map.quantity, map.price, map.amount, map.vatRate, map.vatAmount, map.total], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

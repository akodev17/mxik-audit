import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { build1cCsv, ONE_C_HEADERS_RU } from './export-1c.js';
import { fileLine } from './sheet-shape.js';
import { MAX_ROWS, numberText, parseUpload, ParseError, sniffKind } from './spreadsheet.js';

const MB = 1024 * 1024;

/** windows-1251 bytes for ASCII and the basic Cyrillic alphabet (enough for these fixtures). */
function cp1251(text: string): Buffer {
  return Buffer.from([...text].map((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) return code;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (ch === 'Ё') return 0xa8;
    if (ch === 'ё') return 0xb8;
    throw new Error(`no cp1251 byte for ${ch}`);
  }));
}

async function rejects(buffer: Buffer, code: string): Promise<void> {
  await assert.rejects(parseUpload(buffer, 'file'), (error: unknown) => error instanceof ParseError && error.code === code);
}

describe('parseUpload: text files', () => {
  it('drops a UTF-8 byte-order mark and reads ";" with decimal commas', async () => {
    const csv = '﻿Nomi;Narxi;MXIK\r\nGuruch;12,5;06301001001000000\r\nShakar;7;\r\n';
    const parsed = await parseUpload(Buffer.from(csv, 'utf8'), 'a.csv');
    assert.deepEqual(parsed.headers, ['Nomi', 'Narxi', 'MXIK']);
    assert.deepEqual(parsed.rows, [['Guruch', '12,5', '06301001001000000'], ['Shakar', '7', '']]);
    assert.equal(parsed.meta.encoding, 'utf-8');
    assert.equal(parsed.meta.delimiter, ';');
    assert.equal(parsed.truncated, false);
  });

  it('falls back to windows-1251 when the bytes are not UTF-8', async () => {
    const parsed = await parseUpload(cp1251('Наименование;Ед. изм.\nСахар;кг\nМука;кг\n'), 'b.csv');
    assert.equal(parsed.meta.encoding, 'windows-1251');
    assert.deepEqual(parsed.headers, ['Наименование', 'Ед. изм.']);
    assert.deepEqual(parsed.rows[0], ['Сахар', 'кг']);
  });

  it('sniffs tab and comma delimiters, ignoring delimiters inside quotes', async () => {
    const tab = await parseUpload(Buffer.from('name\tcode\n"Rice; long"\t1\n', 'utf8'), 'c.tsv');
    assert.equal(tab.meta.delimiter, '\t');
    assert.deepEqual(tab.rows, [['Rice; long', '1']]);
    const comma = await parseUpload(Buffer.from('name,price\n"Tea, green",5\nCoffee,7\n', 'utf8'), 'd.csv');
    assert.equal(comma.meta.delimiter, ',');
    assert.deepEqual(comma.rows, [['Tea, green', '5'], ['Coffee', '7']]);
  });

  it('skips a title row above the header without losing data columns', async () => {
    const csv = 'Mahsulotlar roʻyxati 2026\n\nNomi;Birlik\nGuruch;kg;06301001001000000\nShakar;kg\n';
    const parsed = await parseUpload(Buffer.from(csv, 'utf8'), 'e.csv');
    assert.equal(parsed.meta.headerRow, 3);
    assert.equal(parsed.meta.skippedAbove, 1);
    assert.equal(parsed.meta.emptyRowsSkipped, 1);
    // The data row is wider than the header: its third cell is kept under a placeholder name.
    assert.deepEqual(parsed.headers, ['Nomi', 'Birlik', 'Ustun 3']);
    assert.deepEqual(parsed.rows, [['Guruch', 'kg', '06301001001000000'], ['Shakar', 'kg', '']]);
  });

  it('keeps the file line of every data row, across a title and empty rows', async () => {
    const csv = 'Narxlar roʻyxati\nNomi;MXIK\nGuruch;1\nShakar;2\n\nTuz;3\nUn;4\n';
    const parsed = await parseUpload(Buffer.from(csv, 'utf8'), 'lines.csv');
    assert.equal(parsed.meta.headerRow, 2);
    assert.deepEqual(parsed.meta.lineJumps, [[3, 6]]);
    // Data rows 1..4 are file lines 3, 4, 6 and 7: what Excel shows.
    assert.deepEqual([1, 2, 3, 4].map((r) => fileLine(parsed.meta, r)), [3, 4, 6, 7]);
    assert.equal(fileLine({ headerRow: 2 }, 1), null, 'uploads read before lines were kept say nothing');
  });

  it('marks truncation only when rows exceed the limit, and counts every row seen', async () => {
    const lines = ['name;code', ...Array.from({ length: MAX_ROWS + 5 }, (_, i) => `Item ${i};${i}`)];
    const parsed = await parseUpload(Buffer.from(lines.join('\n'), 'utf8'), 'f.csv');
    assert.equal(parsed.rows.length, MAX_ROWS);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.totalSeen, MAX_ROWS + 5);
    const exact = await parseUpload(Buffer.from(lines.slice(0, MAX_ROWS + 1).join('\n'), 'utf8'), 'g.csv');
    assert.equal(exact.truncated, false);
    assert.equal(exact.totalSeen, MAX_ROWS);
  });

  it('re-imports the app’s own 1C CSV, formula guard included', async () => {
    const csv = build1cCsv([
      { name: '=HYPERLINK("x")', mxik: '06301001001000000', unit: 'kg', barcode: '4780000000017', auditStatus: 'Tasdiqlangan' },
      { name: 'Guruch; 1 kg', mxik: '', unit: '', barcode: '', auditStatus: 'Koʻrib chiqilmagan' },
    ]);
    const parsed = await parseUpload(csv, 'h.csv');
    assert.deepEqual(parsed.headers, [...ONE_C_HEADERS_RU]);
    assert.deepEqual(parsed.rows[0], ['=HYPERLINK("x")', '06301001001000000', 'kg', '4780000000017', 'Tasdiqlangan']);
    assert.equal(parsed.rows[1]?.[0], 'Guruch; 1 kg');
  });

  it('refuses binary content', async () => {
    await rejects(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]), 'binary');
  });
});

describe('parseUpload: spreadsheets', () => {
  it('tells a legacy .xls apart by its magic bytes', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    assert.equal(sniffKind(xls), 'xls');
    await rejects(xls, 'legacy_xls');
  });

  it('refuses a zip bomb before ExcelJS opens it', async () => {
    const zip = new JSZip();
    zip.file('xl/worksheets/sheet1.xml', '<row/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    // A crafted archive declares a huge inflated size.
    for (let i = 0; i + 4 <= buffer.length; i++) {
      if (buffer.readUInt32LE(i) === 0x04034b50) buffer.writeUInt32LE(200 * MB, i + 22);
      if (buffer.readUInt32LE(i) === 0x02014b50) buffer.writeUInt32LE(200 * MB, i + 24);
    }
    assert.equal(sniffKind(buffer), 'xlsx');
    await rejects(buffer, 'zip_limits');
  });

  it('reads .xlsx by content, skips a merged title and keeps numbers exact', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.addRow(['Katalog — 2026', '', '']);
    sheet.mergeCells('A1:C1');
    sheet.addRow(['Nomi', 'Narx', 'MXIK']);
    sheet.addRow(['Guruch', 1.125, '06301001001000000']);
    sheet.addRow(['Shakar', 12500, '06301001001000001']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    // The name says CSV; the content decides.
    const parsed = await parseUpload(buffer, 'renamed.csv');
    assert.equal(parsed.meta.format, 'xlsx');
    assert.deepEqual([fileLine(parsed.meta, 1), fileLine(parsed.meta, 2)], [3, 4], 'sheet rows under the merged title');
    assert.deepEqual(parsed.headers, ['Nomi', 'Narx', 'MXIK']);
    assert.deepEqual(parsed.rows, [['Guruch', '1.1250', '06301001001000000'], ['Shakar', '12500', '06301001001000001']]);
  });

  it('writes numbers so the amount reader cannot mistake them for thousands', () => {
    assert.equal(numberText(1.125), '1.1250');
    assert.equal(numberText(1234.567), '1234.567');
    assert.equal(numberText(12.5), '12.5');
    assert.equal(numberText(12345678901234568), '12345678901234568');
  });
});

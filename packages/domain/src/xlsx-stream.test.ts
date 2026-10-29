// The streaming .xlsx reader (xlsx-stream.ts) against the reader it replaced (ExcelJS's
// workbook.xlsx.load, kept below as the reference): the same grid row by row for the sample, the
// bank fixtures, the 1C golden files and a hand-written workbook with what usually differs (merged
// cells holding values, dates and the 1904 calendar, cached formula results of every type, shared
// formulas, shared, rich and inline strings, `_x000D_` escapes, number formats, sheets out of order,
// Cyrillic across chunk edges). Then the limits: the column cap and the held-parts cap. No database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { BANK_TRANSACTIONS, INVOICE_LINES, INVOICE_META, PRODUCTS, BANK_META } from './onec/fixtures/demo-data.js';
import { buildFile, type FileSettings } from './onec/files.js';
import { planExport, type PlanBatch, type PlanRecord } from './onec/plan.js';
import { build1cXlsx } from './onec/sheets.js';
import { XLSX_HELD_BYTES, zipWithinLimits } from './security/zip-guard.js';
import { MAX_COLUMNS, MAX_ROWS, shapeGrid } from './sheet-shape.js';
import { buildExport, cellText, parseUpload, readGrid } from './spreadsheet.js';
import { eachSheetRow, XlsxReadError } from './xlsx-stream.js';

/** The reader before F13, verbatim but for its error codes: the whole workbook through workbook.xlsx.load. */
async function loadGrid(buffer: Buffer): Promise<{ grid: (string[] | undefined)[]; extra: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('no_sheet');
  const grid: (string[] | undefined)[] = [];
  let kept = 0;
  let extra = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell((cell, col) => {
      if (cell.type === ExcelJS.ValueType.Merge) return;
      values[col - 1] = cellText(cell.value);
    });
    const cells = Array.from(values, (v) => v ?? '');
    if (!cells.some((v) => v !== '')) return;
    if (kept < MAX_ROWS + 20) { grid[row.number - 1] = cells; kept++; } else extra++;
  });
  return { grid, extra };
}

/** Both readers on one file: the raw grid and the parsed upload must match row by row. */
async function sameAsBefore(name: string, buffer: Buffer): Promise<(string[] | undefined)[]> {
  const before = await loadGrid(buffer);
  const now = await readGrid(buffer);
  assert.equal(now.kind, 'xlsx', name);
  assert.equal(now.grid.length, before.grid.length, `${name}: rows`);
  before.grid.forEach((row, i) => assert.deepEqual(now.grid[i], row, `${name}: sheet row ${i + 1}`));
  assert.deepEqual(now.grid, before.grid, name);
  assert.equal(now.extra, before.extra, `${name}: rows past the limit`);
  const shaped = shapeGrid(before.grid, before.extra);
  const parsed = await parseUpload(buffer, `${name}.xlsx`);
  assert.deepEqual({ headers: parsed.headers, rows: parsed.rows, totalSeen: parsed.totalSeen }, { headers: shaped.headers, rows: shaped.rows, totalSeen: shaped.totalSeen }, name);
  assert.equal(parsed.meta.cellsPastColumnLimit, undefined, `${name}: nothing past the column cap`);
  return now.grid;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const cyrillic = (i: number): string => `Сахар рафинад «Тасниво» №${i} — ёлка, щётка, Ўзбекистон, қишлоқ, ғалла, ҳосил`;

/** A workbook written by hand, so it holds what neither Excel's nor ExcelJS's writer would give a test. */
async function nastyWorkbook(date1904: boolean): Promise<Buffer> {
  const strings = ['Nomi', 'MXIK', 'Sana', '', 'Qator_x000D_\nikki', '  boʻsh joy  ', 'Katalog 2026', 'yashirin', 'Narx', 'Holat', 'Formula'];
  const sst = strings.map((s, i) => (i === 3
    ? '<si><r><rPr><b/></rPr><t>Сахар</t></r><r><t xml:space="preserve"> рафинад</t></r></si>'
    : `<si><t xml:space="preserve">${s}</t></si>`)).join('');
  const long = Array.from({ length: 900 }, (_, i) => `<row r="${20 + i}"><c r="A${20 + i}" t="inlineStr"><is><t>${cyrillic(i)}</t></is></c><c r="B${20 + i}"><v>${i}.5</v></c></row>`).join('');
  const first = `<worksheet ${NS}><dimension ref="A1:F920"/><sheetData>
<row r="1"><c r="A1" t="s"><v>6</v></c><c r="B1" t="s"><v>7</v></c><c r="C1" t="s"><v>7</v></c></row>
<row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>8</v></c><c r="E3" t="s"><v>9</v></c><c r="F3" t="s"><v>10</v></c></row>
<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" t="str"><v>06301001001000000</v></c><c r="C4" s="1"><v>46000</v></c><c r="D4" s="3"><v>0.125</v></c><c r="E4" t="b"><v>1</v></c><c r="F4"><f>D4*2</f><v>0.25</v></c></row>
<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5" s="4"><v>6301001001000000</v></c><c r="C5" s="2"><v>45000.5</v></c><c r="D5" t="e"><v>#DIV/0!</v></c><c r="E5" t="b"><f>TRUE()</f><v>1</v></c><c r="F5" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>
<row r="6"><c r="A6" t="inlineStr"><is><t>Inline _x000D_ matn</t></is></c><c r="B6" t="inlineStr"><is><r><t>Boy</t></r><r><rPr><i/></rPr><t xml:space="preserve"> matn</t></r></is></c><c r="C6" s="1"><f>TODAY()</f><v>46300</v></c><c r="D6" t="str"><f>"a"&amp;"b"</f><v>a &amp;lt; b</v></c><c r="E6"><f t="shared" ref="E6:E7" si="0">D4+1</f><v>1.125</v></c><c r="F6" s="1"/></row>
<row r="7"><c r="A7" t="s"><v>5</v></c><c r="E7"><f t="shared" si="0"/><v>2.5</v></c><c r="F7"/></row>
<row r="8"><c r="A8" t="s"><v>3</v></c><c t="n"><v>7</v></c><c r="D8"><v>1E+20</v></c><c r="E8"><v>-0.000001</v></c><c r="F8" s="3"><v>12500</v></c></row>
<row r="10"><c r="A10" t="s"><v>7</v></c><c r="B10" t="s"><v>7</v></c><c r="C10" t="inlineStr"><is><t>  </t></is></c></row>
<row r="11"><c r="A11" t="s"><v>7</v></c><c r="B11" t="s"><v>7</v></c></row>
${long}
</sheetData><mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="A10:B11"/></mergeCells></worksheet>`;
  const second = `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Eski varaq</t></is></c><c r="B1" t="inlineStr"><is><t>bu emas</t></is></c></row></sheetData></worksheet>`;
  const styles = `<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  // Written before the workbook and shared strings, and the sheet listed first is sheet2.xml.
  zip.file('xl/worksheets/sheet1.xml', second);
  zip.file('xl/worksheets/sheet2.xml', first);
  zip.file('xl/workbook.xml', `<workbook ${NS}><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets><sheet name="Katalog" sheetId="2" r:id="rId2"/><sheet name="Eski" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  zip.file('xl/styles.xml', styles);
  zip.file('xl/sharedStrings.xml', `<sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${sst}</sst>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const NOW = new Date('2026-10-23T11:00:00Z');
const settings = (o: Partial<FileSettings> = {}): FileSettings => ({ bankKeys: 'standard', ownerName: 'ООО «Тасниво Тест»', filename: 'vypiska.xlsx', wholeStatement: true, now: NOW, ...o });
const records = (payloads: readonly unknown[]): PlanRecord[] =>
  payloads.map((payload, i) => ({ id: `r${i}`, rowIndex: i, status: 'valid', payload, issues: [], fingerprint: `f${i}`, decision: null }));
const none = { exportedElsewhere: new Map<string, { batchId: string }>() };

describe('streaming .xlsx reader: the same grid as workbook.xlsx.load', () => {
  it('reads the landing sample and the committed spreadsheets identically', async () => {
    const files = [
      'apps/web/public/demo/namuna-katalog.xlsx',
      'packages/domain/src/bank/fixtures/amount-direction.xlsx',
      'packages/domain/src/bank/fixtures/ru-debit-credit.xlsx',
      'packages/domain/src/bank/fixtures/uz-debit-credit.xlsx',
      'docs/accounting-2026-10-23/agent4/round2/catalogue-nomenclature.xlsx',
      'docs/accounting-2026-10-23/agent4/round2/import-nomenclature.xlsx',
    ];
    for (const file of files) {
      const grid = await sameAsBefore(file, readFileSync(join(process.cwd(), file)));
      assert.ok(grid.filter(Boolean).length > 1, `${file} has rows`);
    }
  });

  it('reads the 1C golden files (nomenclature, receipt, counterparties) and the catalogue exports identically', async () => {
    const product: PlanBatch = { id: 'b-prod', kind: 'product_catalog', meta: { source: 'xlsx', headers: [], columnMap: {}, catalogId: null } };
    const invoice: PlanBatch = { id: 'b-inv', kind: 'didox_invoice', meta: INVOICE_META };
    const bank: PlanBatch = { id: 'b-bank', kind: 'bank_statement', meta: BANK_META };
    const built = [
      await buildFile(product, planExport(product, records(PRODUCTS), 'nomenclature_xlsx', undefined, none), 'nomenclature_xlsx', settings({ filename: 'tovary.xlsx' })),
      await buildFile(invoice, planExport(invoice, records(INVOICE_LINES), 'receipt_xlsx', undefined, none), 'receipt_xlsx', settings()),
      await buildFile(bank, planExport(bank, records(BANK_TRANSACTIONS), 'counterparties_xlsx', undefined, none), 'counterparties_xlsx', settings()),
    ];
    for (const file of built) await sameAsBefore(file.filename, file.bytes);
    await sameAsBefore('1c.xlsx', await build1cXlsx([{ name: 'Guruch', mxik: '06301001001000000', unit: 'kg', barcode: '4780000000017', auditStatus: 'OK', restricted: '' }]));
    await sameAsBefore('export.xlsx', await buildExport({
      headers: ['Nomi', 'MXIK', '=SUM(A1)'], rows: [{ original: ['Guruch', '', '=1+1'], mxik: '06301001001000000', unit: 'kg', packaging: '', auditStatus: 'OK' }],
      mxikColumn: 1, unitColumn: null, labels: { mxik: 'MXIK', unit: 'Birlik', packaging: 'Qadoq', auditStatus: 'Holat', restricted: 'EHF' },
    }));
  });

  it('reads merged cells, dates, cached formula results, rich and inline strings and sheet order identically', async () => {
    for (const date1904 of [false, true]) {
      const grid = await sameAsBefore(`nasty-${date1904}`, await nastyWorkbook(date1904));
      // Not vacuous: the reference and the new reader agree on these values.
      assert.deepEqual(grid[0], ['Katalog 2026'], 'merged title: the merged cells holding text are dropped');
      assert.equal(grid[3]?.[0], 'Сахар рафинад');
      assert.equal(grid[3]?.[1], '06301001001000000');
      assert.match(grid[3]?.[2] ?? '', /^\d{4}-\d{2}-\d{2}$/, 'a date-formatted number is a date');
      assert.deepEqual(grid[4]?.slice(3), ['', 'true', ''], 'error cell, boolean and error formula results');
      assert.equal(grid[4]?.[0], 'Qator\r\nikki', '_x000D_ in a shared string');
      assert.equal(grid[7]?.[1], '7', 'a cell without an address follows the previous one');
      assert.deepEqual(grid[9], ['yashirin', '', ''], 'merged block: only its top-left cell (C10 is blank text)');
      assert.equal(grid[10], undefined, 'a row holding only merged cells is empty');
      assert.equal(grid[19 + 899]?.[0], cyrillic(899));
      assert.equal(grid.filter(Boolean).length, 8 + 900, 'rows 1, 3-8 and 10, then the long block');
    }
  });

  it('reads the workbooks the existing upload tests write identically', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.addRow(['Katalog — 2026', '', '']);
    sheet.mergeCells('A1:C1');
    sheet.addRow(['Nomi', 'Narx', 'MXIK', 'Sana', 'Foiz']);
    sheet.addRow(['Guruch', 1.125, '06301001001000000', new Date(Date.UTC(2026, 9, 29)), { formula: 'B3*2', result: 2.25 }]);
    sheet.addRow([{ richText: [{ text: 'Shakar ' }, { font: { bold: true }, text: 'oq' }] }, 12500, { text: 'havola', hyperlink: 'https://tasnivo.uz' }, true, { error: '#N/A' }]);
    sheet.getCell('E3').numFmt = '0.00%';
    workbook.addWorksheet('Ikkinchi').addRow(['boshqa']);
    await sameAsBefore('exceljs', Buffer.from(await workbook.xlsx.writeBuffer()));
  });
});

describe('streaming .xlsx reader: limits', () => {
  it(`reads ${MAX_COLUMNS} columns and counts the cells past them, without an error`, async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    const width = MAX_COLUMNS + 20;
    sheet.addRow(Array.from({ length: width }, (_, i) => `H${i + 1}`));
    sheet.addRow(Array.from({ length: width }, (_, i) => (i === 0 ? 'Guruch' : i % 2 ? String(i) : '')));
    const parsed = await parseUpload(Buffer.from(await workbook.xlsx.writeBuffer()), 'wide.xlsx');
    assert.equal(parsed.headers.length, MAX_COLUMNS);
    assert.equal(parsed.headers[MAX_COLUMNS - 1], `H${MAX_COLUMNS}`);
    assert.equal(parsed.rows[0]?.length, MAX_COLUMNS);
    assert.equal(parsed.rows[0]?.[0], 'Guruch');
    // 20 header cells and the 10 odd columns of the data row right of the cap.
    assert.equal(parsed.meta.cellsPastColumnLimit, 30);
  });

  it('refuses a workbook whose shared strings and styles would inflate past the held-parts cap', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('S').addRow(['Nomi', 'x'.repeat(4000)]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    await assert.rejects(eachSheetRow(buffer, () => undefined, { maxColumns: MAX_COLUMNS, maxHeldBytes: 2000 }), (e: unknown) => e instanceof XlsxReadError && e.code === 'held_limit');
    const rows: unknown[][] = [];
    await eachSheetRow(buffer, (_, values) => rows.push(values), { maxColumns: MAX_COLUMNS, maxHeldBytes: 1024 * 1024 });
    assert.equal(rows.length, 1);
  });

  it(`answers zip_limits when the held parts inflate past ${XLSX_HELD_BYTES / 1024 / 1024} MB, though the whole archive is within its cap`, async () => {
    const zip = await JSZip.loadAsync(await nastyWorkbook(false));
    const pad = '<si><t>to‘ldiruvchi matn</t></si>'.repeat(Math.ceil(XLSX_HELD_BYTES / 30));
    zip.file('xl/sharedStrings.xml', `<sst ${NS}><si><t>Nomi</t></si>${pad}</sst>`);
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    assert.ok(await zipWithinLimits(buffer), 'the archive itself passes the zip guard');
    await assert.rejects(parseUpload(buffer, 'big.xlsx'), (e: unknown) => (e as { code?: string }).code === 'zip_limits');
  });

  it('answers no_sheet and unreadable with the old codes', async () => {
    const noBook = new JSZip();
    noBook.file('xl/worksheets/sheet1.xml', `<worksheet ${NS}><sheetData/></worksheet>`);
    await assert.rejects(parseUpload(await noBook.generateAsync({ type: 'nodebuffer' }), 'a.xlsx'), (e: unknown) => (e as { code?: string }).code === 'no_sheet');
    const broken = await nastyWorkbook(false);
    const zip = await JSZip.loadAsync(broken);
    zip.file('xl/worksheets/sheet2.xml', `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row><row`);
    await assert.rejects(parseUpload(await zip.generateAsync({ type: 'nodebuffer' }), 'b.xlsx'), (e: unknown) => (e as { code?: string }).code === 'unreadable');
  });

  it('keeps the first rows of an over-long sheet and still counts the rest for the truncation notice', async () => {
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useSharedStrings: false });
    const sheet = writer.addWorksheet('S');
    sheet.addRow(['Nomi', 'Kod']).commit();
    for (let i = 0; i < MAX_ROWS + 25; i++) sheet.addRow([`Tovar ${i}`, i]).commit();
    sheet.commit();
    await writer.commit();
    const parsed = await parseUpload(Buffer.concat(chunks), 'long.xlsx');
    assert.equal(parsed.rows.length, MAX_ROWS);
    assert.equal(parsed.totalSeen, MAX_ROWS + 25);
    assert.equal(parsed.truncated, true);
    assert.deepEqual(parsed.rows[MAX_ROWS - 1], [`Tovar ${MAX_ROWS - 1}`, String(MAX_ROWS - 1)]);
  });
});

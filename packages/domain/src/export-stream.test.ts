// The corrected Excel is written with ExcelJS's streaming writer (spreadsheet.ts buildExport). The
// in-memory builder it replaced is kept here as the reference: both files are read back and must
// hold the same sheet name, cells (value and type), cell styles, column widths and formats, frozen
// header and creator, on the demo catalogue, the option sets the other export tests use, and a
// generated 5,000-row sheet.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { formulaSafe } from './csv-safe.js';
import { buildExport, parseUpload, type ExportOptions, type ExportRow } from './spreadsheet.js';

/** spreadsheet.ts buildExport before S8, unchanged. */
async function buildExportInMemory(options: ExportOptions): Promise<Buffer> {
  const { headers, rows, mxikColumn, unitColumn, labels } = options;
  const outHeaders = [...headers];
  const mxikIndex = mxikColumn ?? (outHeaders.push(labels.mxik) - 1);
  const unitIndex = unitColumn ?? (outHeaders.push(labels.unit) - 1);
  const packagingIndex = outHeaders.push(labels.packaging) - 1;
  const statusIndex = outHeaders.push(labels.auditStatus) - 1;
  const restrictedIndex = outHeaders.push(labels.restricted) - 1;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tasnivo';
  const sheet = workbook.addWorksheet(options.sheetName ?? 'Katalog');
  sheet.addRow(outHeaders.map(formulaSafe));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });
  for (const row of rows) {
    const cells = [...row.original];
    while (cells.length < outHeaders.length) cells.push('');
    cells[mxikIndex] = row.mxik;
    cells[unitIndex] = row.unit;
    cells[packagingIndex] = row.packaging;
    cells[statusIndex] = row.auditStatus;
    cells[restrictedIndex] = row.restricted ?? '';
    sheet.addRow(cells.map(formulaSafe));
  }
  sheet.getColumn(mxikIndex + 1).numFmt = '@';
  sheet.getColumn(mxikIndex + 1).width = 20;
  sheet.getColumn(statusIndex + 1).width = 24;
  sheet.getColumn(restrictedIndex + 1).width = 26;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

type Snapshot = {
  creator: string;
  sheets: { name: string; views: unknown; columns: unknown[]; rows: unknown[][] }[];
};

/** Everything a reader of the file sees, as plain data. */
async function snapshot(buffer: Buffer): Promise<Snapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return {
    creator: workbook.creator,
    sheets: workbook.worksheets.map((ws) => {
      const rows: unknown[][] = [];
      // Both getters walk every row: read them once.
      const { rowCount, columnCount } = ws;
      for (let r = 1; r <= rowCount; r++) {
        const row = ws.getRow(r);
        const cells: unknown[] = [];
        for (let col = 1; col <= columnCount; col++) {
          const cell = row.getCell(col);
          cells.push({ value: cell.value, type: cell.type, style: JSON.parse(JSON.stringify(cell.style ?? {})) as unknown });
        }
        rows.push(cells);
      }
      return {
        name: ws.name,
        views: ws.views.map((v) => ({ state: v.state, ySplit: (v as { ySplit?: number }).ySplit, xSplit: (v as { xSplit?: number }).xSplit })),
        columns: (ws.columns ?? []).map((c) => ({ width: c.width, numFmt: c.numFmt, style: JSON.parse(JSON.stringify(c.style ?? {})) as unknown })),
        rows,
      };
    }),
  };
}

async function sameAsInMemory(label: string, options: ExportOptions): Promise<Snapshot> {
  const [streamed, inMemory] = await Promise.all([buildExport(options).then(snapshot), buildExportInMemory(options).then(snapshot)]);
  assert.deepEqual(streamed, inMemory, `${label}: the streamed file differs from the in-memory one`);
  return streamed;
}

const LABELS = { mxik: 'MXIK kodi', unit: 'Oʻlchov birligi', packaging: 'Qadoqlash', auditStatus: 'Audit holati', restricted: 'EHF cheklovi' };
const STATUSES = ['Xavf topilmadi', 'Tasdiqlandi', 'Koʻrib chiqilmagan', 'Tekshirilmadi: nomi yoʻq', 'Tekshirilmadi: texnik xato'];

const rowFor = (original: string[], i: number): ExportRow => ({
  original,
  mxik: i % 5 === 0 ? '' : `0630100100${String(1000000 + i).slice(-7)}`,
  unit: i % 3 === 0 ? 'kg' : 'dona',
  packaging: i % 7 === 0 ? 'quti' : '',
  auditStatus: STATUSES[i % STATUSES.length] ?? '',
  restricted: i % 11 === 0 ? '01.07.2026 dan EHFda cheklangan' : '',
});

describe('streaming corrected Excel', () => {
  it('equals the in-memory builder on the demo catalogue, mapped and appended code and unit columns', async () => {
    const parsed = await parseUpload(readFileSync(join(process.cwd(), 'apps/web/public/demo/namuna-katalog.xlsx')), 'namuna-katalog.xlsx');
    const rows = parsed.rows.map(rowFor);
    const appended = await sameAsInMemory('demo, appended', { headers: parsed.headers, rows, mxikColumn: null, unitColumn: null, labels: LABELS, sheetName: 'Katalog' });
    assert.equal(appended.sheets[0]?.rows.length, parsed.rows.length + 1, 'every row and the header');
    await sameAsInMemory('demo, in place', { headers: parsed.headers, rows, mxikColumn: 1, unitColumn: Math.min(2, parsed.headers.length - 1), labels: LABELS });
  });

  it('equals it on the other export tests\' shapes: formulas defused, ragged rows, Cyrillic, no rows, another sheet name', async () => {
    await sameAsInMemory('formulas', {
      headers: ['Nomi', 'MXIK', '=SUM(A1)'], rows: [{ original: ['Guruch', '', '=1+1'], mxik: '06301001001000000', unit: 'kg', packaging: '', auditStatus: 'OK' }],
      mxikColumn: 1, unitColumn: null, labels: { mxik: 'MXIK', unit: 'Birlik', packaging: 'Qadoq', auditStatus: 'Holat', restricted: 'EHF' },
    });
    const snap = await sameAsInMemory('ragged', {
      headers: ['Наименование', 'Ед.', 'Цена'],
      rows: [
        { original: ['Сахар рафинад'], mxik: '06301001001000000', unit: 'кг', packaging: '', auditStatus: 'Принято', restricted: '' },
        { original: ['', 'шт', '1 200', 'лишняя', 'ещё'], mxik: '', unit: 'шт', packaging: '', auditStatus: 'Не проверено: нет наименования' },
        { original: ['@cmd', '+1', '-2'], mxik: '-', unit: '=A1', packaging: '', auditStatus: 'Не рассмотрено', restricted: '' },
      ],
      mxikColumn: null, unitColumn: 1, labels: LABELS, sheetName: 'Каталог',
    });
    assert.equal(snap.sheets[0]?.name, 'Каталог');
    // Not vacuous: values as written, styles as set.
    const header = snap.sheets[0]?.rows[0] as { value: unknown; style: { font?: { bold?: boolean } } }[];
    assert.equal(header[0]?.value, 'Наименование');
    assert.equal(header[0]?.style.font?.bold, true);
    const third = snap.sheets[0]?.rows[3] as { value: unknown }[];
    assert.deepEqual(third.slice(0, 3).map((c) => c.value), ['\'@cmd', '\'=A1', '-2'], 'the unit column (index 1) overwritten in place, every cell defused');
    await sameAsInMemory('no rows', { headers: ['Nomi'], rows: [], mxikColumn: null, unitColumn: null, labels: LABELS });
  });

  it('equals it on a generated 5,000-row sheet', async () => {
    const headers = ['Nomi', 'Shtrix-kod', 'MXIK', 'Birlik', 'Narx', 'Soni', 'Izoh', 'Ombor'];
    const rows = Array.from({ length: 5000 }, (_, i) => rowFor([
      i % 97 === 0 ? '' : `Tovar ${i} ${i % 2 ? 'Сахар' : 'Guruch'} ${i % 13}kg`, `478${String(i).padStart(10, '0')}`, '', i % 3 ? 'dona' : 'kg',
      `${(i * 137) % 100000},${i % 100}`, String(i % 50), i % 17 === 0 ? '=HYPERLINK("x")' : `izoh ${i}`, `Ombor ${i % 4}`,
    ], i));
    const snap = await sameAsInMemory('5,000 rows', { headers, rows, mxikColumn: 2, unitColumn: 3, labels: LABELS });
    assert.equal(snap.sheets[0]?.rows.length, 5001);
  });
});

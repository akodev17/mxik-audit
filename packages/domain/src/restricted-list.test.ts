import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { dateOnly, findingOut } from './api/serialize.js';
import { build1cCsv, build1cXlsx, ONE_C_HEADERS_RU } from './export-1c.js';
import { dict } from '@tasnivo/i18n/i18n';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { parseRestrictedSheet, RESTRICTED_SOURCE_URL } from './restricted-list.js';
import { buildExport } from './spreadsheet.js';

/** The official perechen.xlsx layout: a title on row 2, the header on row 4, data from row 5. */
function officialSheet(rows: (string | number | null)[][]): ExcelJS.Worksheet {
  const sheet = new ExcelJS.Workbook().addWorksheet('Лист1');
  sheet.getCell('A2').value = { richText: [{ text: '2026 йил 1 июл' }, { text: 'дан бошлаб, ЭҲФда ... РЎЙХАТИ' }] };
  sheet.getRow(4).values = ['Т/р', 'МХИК коди', 'МХИК номи (Лотин алифбосида)', 'МХИК номи (Ўзб)', 'МХИК номи (Рус)'];
  rows.forEach((r, i) => { sheet.getRow(5 + i).values = r; });
  return sheet;
}

async function sheetCells(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const out: string[][] = [];
  workbook.worksheets[0]?.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = typeof cell.value === 'string' ? cell.value : ''; });
    out.push(Array.from(cells, (c) => c ?? ''));
  });
  return out;
}

describe('restricted list loader', () => {
  it('reads codes and the Russian name from the official layout', () => {
    const parsed = parseRestrictedSheet(officialSheet([
      [1, '02505001002000000', 'Kvars qumi', 'Кварц қуми', 'Кварцевый песок'],
      [2, '02505001004000000', 'Boshqa tabiiy qumlar', 'Бошқа табиий қумлар', ''],
      [423, '07318001007000091', 'Rezbali boshqa mahsulotlar', '', ''],
    ]));
    assert.deepEqual(parsed.entries, [
      { code: '02505001002000000', name: 'Кварцевый песок' },
      { code: '02505001004000000', name: 'Бошқа табиий қумлар' },
      { code: '07318001007000091', name: 'Rezbali boshqa mahsulotlar' },
    ]);
    assert.deepEqual(parsed.skipped, []);
    assert.deepEqual(parsed.duplicates, []);
  });

  it('ignores empty rows, reports bad codes and keeps a repeated code once', () => {
    const parsed = parseRestrictedSheet(officialSheet([
      [1, '0250 5001 002 000000', 'Kvars qumi', '', 'Кварцевый песок'],
      [null, null, null, null, null],
      [2, '2505001002', 'Qisqa kod', '', ''],
      [3, '02505001002000000', 'Kvars qumi', '', 'Кварцевый песок'],
    ]));
    assert.deepEqual(parsed.entries.map((e) => e.code), ['02505001002000000']);
    assert.deepEqual(parsed.skipped, [{ row: 7, value: '2505001002' }]);
    assert.deepEqual(parsed.duplicates, ['02505001002000000']);
  });

  it('finds the header wherever the title block ends', () => {
    const sheet = new ExcelJS.Workbook().addWorksheet('x');
    sheet.getRow(1).values = ['№', 'MXIK kodi', 'Nomi'];
    sheet.getRow(2).values = [1, '02505001002000000', 'Kvars qumi'];
    assert.deepEqual(parseRestrictedSheet(sheet).entries, [{ code: '02505001002000000', name: 'Kvars qumi' }]);
  });

  it('points at the official news item', () => {
    assert.equal(RESTRICTED_SOURCE_URL, 'https://tasnif.soliq.uz/news/5063');
  });
});

describe('RESTRICTED in the exports', () => {
  it('adds the restriction as the last column of the corrected Excel', async () => {
    const buffer = await buildExport({
      headers: ['Nomi'],
      rows: [
        { original: ['Sement'], mxik: '02523001001000000', unit: 'tonna', packaging: '', auditStatus: 'Koʻrib chiqilmagan', restricted: '01.07.2026 dan EHFda cheklangan' },
        { original: ['Shakar'], mxik: '01701001002000000', unit: 'kg', packaging: '', auditStatus: 'Xavf topilmadi' },
      ],
      mxikColumn: null, unitColumn: null,
      labels: { mxik: 'MXIK', unit: 'Birlik', packaging: 'Qadoq', auditStatus: 'Holat', restricted: 'EHF cheklovi' },
    });
    const [header, restricted, clean] = await sheetCells(buffer);
    assert.equal(header?.at(-1), 'EHF cheklovi');
    assert.equal(restricted?.at(-1), '01.07.2026 dan EHFda cheklangan');
    assert.equal(clean?.[5] ?? '', '');
  });

  it('adds it as the sixth column of both 1C files', async () => {
    const rows = [{ name: 'Sement', mxik: '02523001001000000', unit: 'tonna', barcode: '', auditStatus: 'x', restricted: 'Ограничен в ЭСФ с 01.07.2026' }];
    const line = build1cCsv(rows).toString('utf8').split('\r\n');
    assert.equal(line[0]?.split(';').at(-1), 'Ограничение в ЭСФ');
    assert.equal(line[1]?.split(';').at(-1), 'Ограничен в ЭСФ с 01.07.2026');
    const [header, row] = await sheetCells(await build1cXlsx(rows));
    assert.deepEqual(header, [...ONE_C_HEADERS_RU]);
    assert.equal(row?.[5], 'Ограничен в ЭСФ с 01.07.2026');
  });
});

describe('RESTRICTED texts', () => {
  it('exist in both languages', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const t = dict(locale);
      const ta = appDict(locale);
      assert.ok(t.typeRestricted.length > 0, locale);
      assert.ok(ta.wsX.explain['RESTRICTED'], locale);
      assert.match(ta.wsX.reason.restricted('02523001001000000', '01.07.2026', true), /01\.07\.2026.*02523001001000000/);
      assert.match(ta.wsX.reason.restrictedNone, /mkinfo\.uz/);
      assert.ok(ta.importX.exp.columns.restricted.length > 0, locale);
      assert.equal(ta.importX.exp.oneC.length, 6, locale);
      assert.match(ta.importX.exp.restrictedFrom('01.07.2026'), /01\.07\.2026/);
    }
    assert.notEqual(dict('uz').typeRestricted, dict('ru').typeRestricted);
  });
});

describe('RESTRICTED in the API', () => {
  const finding = {
    id: 'f1', type: 'RESTRICTED', severity: 'high', suggestedMxik: null, confidence: null, reason: 'r',
    decision: 'pending', chosenMxik: null, decisionSource: null,
    item: { rowIndex: 0, rawName: 'Sement', barcode: null, unit: null, existingMxik: '02523001001000000' },
  };

  it('sends the date as YYYY-MM-DD, null for other findings', () => {
    assert.equal(findingOut({ ...finding, restrictedFrom: new Date('2026-07-01T00:00:00Z') }).restrictedFrom, '2026-07-01');
    assert.equal(findingOut({ ...finding, type: 'MISSING', restrictedFrom: null }).restrictedFrom, null);
    assert.equal(dateOnly(undefined), null);
  });
});

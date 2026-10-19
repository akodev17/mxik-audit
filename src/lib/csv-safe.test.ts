import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { formulaSafe } from './csv-safe.js';
import { build1cCsv, build1cXlsx } from './export-1c.js';
import { buildExport } from './spreadsheet.js';

const DANGEROUS = ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx', '=HYPERLINK("http://evil","x")'];

async function cellsOf(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const out: string[] = [];
  workbook.worksheets[0]?.eachRow((row) => row.eachCell((cell) => {
    // Every cell must be written as a plain value, never as a formula.
    assert.equal(typeof cell.value, 'string');
    out.push(typeof cell.value === 'string' ? cell.value : '');
  }));
  return out;
}

describe('formula injection guard', () => {
  it('prefixes cells that start like a formula, and leaves plain numbers alone', () => {
    for (const value of DANGEROUS) assert.equal(formulaSafe(value), `'${value}`);
    assert.equal(formulaSafe('-5'), '-5');
    assert.equal(formulaSafe('-12,50'), '-12,50');
    assert.equal(formulaSafe('Guruch'), 'Guruch');
    assert.equal(formulaSafe(''), '');
  });

  it('guards the 1C CSV', () => {
    const csv = build1cCsv([{ name: '=1+1', mxik: '06301001001000000', unit: '@kg', barcode: '', auditStatus: '+x' }]).toString('utf8');
    const line = csv.split('\r\n')[1] ?? '';
    assert.equal(line, "'=1+1;06301001001000000;'@kg;;'+x");
  });

  it('guards the 1C .xlsx and keeps code columns as text', async () => {
    const buffer = await build1cXlsx([{ name: '=1+1', mxik: '06301001001000000', unit: 'kg', barcode: '0478000000001', auditStatus: 'ok' }]);
    const cells = await cellsOf(buffer);
    assert.ok(cells.includes("'=1+1"));
    assert.ok(cells.includes('06301001001000000'));
    assert.ok(cells.includes('0478000000001'));
  });

  it('guards every text cell of the corrected Excel', async () => {
    const buffer = await buildExport({
      headers: ['Nomi', '=Narx'],
      rows: [{ original: ['@SUM(1)', '-5'], mxik: '06301001001000000', unit: 'kg', packaging: '', auditStatus: '=x' }],
      mxikColumn: null, unitColumn: null,
      labels: { mxik: 'MXIK', unit: 'Birlik', packaging: 'Qadoq', auditStatus: 'Holat' },
    });
    const cells = await cellsOf(buffer);
    assert.ok(cells.includes("'=Narx"));
    assert.ok(cells.includes("'@SUM(1)"));
    assert.ok(cells.includes('-5'));
    assert.ok(cells.includes("'=x"));
  });
});

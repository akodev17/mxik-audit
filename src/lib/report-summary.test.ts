import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PdfRow } from './pdf/report-data.js';
import { reportCsv, type ReportCsvLabels } from './report-csv.js';
import { decisionSplit, typeLines } from './report-summary.js';

const row = (over: Partial<PdfRow>): PdfRow => ({
  rowIndex: 0, product: 'Sut', type: 'MISSING', current: null, suggested: { code: '04001001001001001', name: 'Sut' },
  decision: 'pending', chosen: null, source: null, automatic: false, decidedBy: null, ...over,
});

describe('report summary', () => {
  const rows = [
    row({ rowIndex: 0 }),
    row({ rowIndex: 1, decision: 'accepted', source: 'manual', decidedBy: 'a@x.uz' }),
    row({ rowIndex: 2, decision: 'accepted', automatic: true, source: 'carry_over' }),
    row({ rowIndex: 3, type: 'MISMATCH', decision: 'rejected', decidedBy: 'a@x.uz' }),
  ];

  it('counts open, accepted and rejected per type, and keeps the catalogue-wide finding count', () => {
    const lines = typeLines({ byType: [{ type: 'MISSING', count: 40 }, { type: 'MISMATCH', count: 9 }], rows });
    assert.deepEqual(lines, [
      { type: 'MISSING', findings: 40, open: 1, accepted: 2, rejected: 0 },
      { type: 'MISMATCH', findings: 9, open: 0, accepted: 0, rejected: 1 },
    ]);
  });

  it('separates decisions a person made from automatic ones, and leaves pending out', () => {
    assert.deepEqual(decisionSplit(rows), { byPeople: 2, automatic: 1 });
    assert.deepEqual(decisionSplit([]), { byPeople: 0, automatic: 0 });
  });

  it('writes a CSV that says pending is pending and neutralises formulas', () => {
    const labels: ReportCsvLabels = {
      columns: { row: 'Qator', product: 'Tovar', type: 'Turi', current: 'Kod', currentName: 'Nomi', suggested: 'Taklif', suggestedName: 'Taklif nomi', decision: 'Qaror', chosen: 'Tanlangan', source: 'Manba', by: 'Kim' },
      decisions: { pending: 'Koʻrib chiqilmagan', accepted: 'Tasdiqlangan', rejected: 'Rad etilgan' },
      types: { MISSING: 'Kod yoʻq' }, sources: { carry_over: 'koʻchirilgan' },
    };
    const csv = reportCsv([row({ product: '=1+1' }), rows[2] as PdfRow], labels).replace(/^\uFEFF/, '').trim().split('\r\n');
    assert.equal(csv.length, 3);
    assert.match(csv[1] ?? '', /^1,'=1\+1,Kod yoʻq,,,04001001001001001,Sut,Koʻrib chiqilmagan,/);
    assert.match(csv[2] ?? '', /Tasdiqlangan,,koʻchirilgan,$/);
  });
});

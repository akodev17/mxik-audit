import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PdfRow, ReportPdfData } from './report-data.js';
import { buildReportPdf } from './report-pdf.js';

const row = (overrides: Partial<PdfRow>): PdfRow => ({
  rowIndex: 0, product: 'Guruch Lazer 1 kg', type: 'MISMATCH',
  current: { code: '06301001001000000', name: 'Guruch' }, suggested: { code: '06301001002000000', name: 'Guruch, oq' },
  decision: 'pending', chosen: null, source: null, automatic: false, decidedBy: null, ...overrides,
});

const data = (rows: PdfRow[]): ReportPdfData => ({
  firmName: 'Test firma', logo: null, clientName: 'Mijoz', filename: 'katalog.xlsx', generatedAt: new Date('2026-10-19T10:00:00Z'),
  classifierDate: new Date('2026-10-01T00:00:00Z'), totalRows: 120, riskyRows: rows.length,
  byType: [{ type: 'MISMATCH', count: rows.length }], markingRows: 0, rows, truncated: false,
  checks: { purchases: true },
  counts: { detected: rows.length, suggested: rows.length, decided: rows.filter((r) => r.decision !== 'pending').length, automatic: rows.filter((r) => r.automatic).length, unresolved: rows.filter((r) => r.decision === 'pending').length },
  rowReview: { done: 2, partial: 0, open: 1 },
  limits: { notRead: 10, totalSeen: 130, dropped: 2, badCodes: 1 }, pipeline: null,
});

describe('report PDF', () => {
  it('draws unresolved and decided findings for both audiences, and a clean report', async () => {
    const rows = [
      row({}),
      row({ rowIndex: 1, decision: 'accepted', source: 'carry_over', automatic: true, decidedBy: 'buxgalter@test.local' }),
      row({ rowIndex: 2, decision: 'rejected', source: 'manual', decidedBy: 'buxgalter@test.local' }),
    ];
    for (const audience of ['internal', 'client'] as const) {
      for (const locale of ['uz', 'ru'] as const) {
        const pdf = await buildReportPdf(data(rows), locale, audience);
        assert.equal(pdf.subarray(0, 4).toString('latin1'), '%PDF');
      }
    }
    const clean = await buildReportPdf({ ...data([]), riskyRows: 0, limits: null }, 'uz');
    assert.equal(clean.subarray(0, 4).toString('latin1'), '%PDF');
  });
});

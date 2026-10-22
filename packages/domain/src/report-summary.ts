// Figures for the on-screen report, from the data the PDF already prints (lib/pdf/report-data.ts), so the
// page, the PDF and the CSV cannot disagree. Pure.
import type { PdfRow, ReportPdfData } from './pdf/report-data.js';

export type TypeLine = { type: string; findings: number; open: number; accepted: number; rejected: number };

/**
 * One line per finding type: the number of findings in the whole catalogue, and how many of the listed
 * rows are open, accepted or rejected. The listed rows are capped (PDF_ROW_LIMIT), so the three decision
 * columns are complete only when the report is not truncated.
 */
export function typeLines(data: Pick<ReportPdfData, 'byType' | 'rows'>): TypeLine[] {
  return data.byType.map(({ type, count }) => {
    const rows = data.rows.filter((r) => r.type === type);
    return {
      type, findings: count,
      open: rows.filter((r) => r.decision === 'pending').length,
      accepted: rows.filter((r) => r.decision === 'accepted').length,
      rejected: rows.filter((r) => r.decision === 'rejected').length,
    };
  });
}

/** Decisions a person made against decisions the system carried or learned. */
export function decisionSplit(rows: readonly Pick<PdfRow, 'decision' | 'automatic'>[]): { byPeople: number; automatic: number } {
  const decided = rows.filter((r) => r.decision !== 'pending');
  return { byPeople: decided.filter((r) => !r.automatic).length, automatic: decided.filter((r) => r.automatic).length };
}

// The report's findings as CSV: one line per risky finding with its suggestion and its decision. Pure.
import { csvCell } from './accuracy.js';
import type { PdfRow } from './pdf/report-data.js';

export type ReportCsvLabels = {
  columns: { row: string; product: string; type: string; current: string; currentName: string; suggested: string; suggestedName: string; decision: string; chosen: string; source: string; by: string };
  decisions: Record<PdfRow['decision'], string>;
  types: Record<string, string>;
  sources: Record<string, string>;
};

/** UTF-8 with a byte-order mark for Excel; formulas in names are neutralised. A suggestion is only a suggestion until the decision column says otherwise. */
export function reportCsv(rows: readonly PdfRow[], labels: ReportCsvLabels): string {
  const c = labels.columns;
  const head = [c.row, c.product, c.type, c.current, c.currentName, c.suggested, c.suggestedName, c.decision, c.chosen, c.source, c.by];
  const lines = rows.map((r) => [
    String(r.rowIndex + 1), r.product, labels.types[r.type] ?? r.type,
    r.current?.code ?? '', r.current?.name ?? '', r.suggested?.code ?? '', r.suggested?.name ?? '',
    labels.decisions[r.decision], r.chosen?.code ?? '', r.source ? labels.sources[r.source] ?? r.source : '', r.decidedBy ?? '',
  ].map(csvCell).join(','));
  return `\uFEFF${[head.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}

// The reconciliation of a statement: opening balance + credits − debits against the closing
// balance the bank printed, the bank's own totals row against the lines read, totals by
// operation and by review status, and every line that did not or will not go to 1C with the
// reason. Exact decimal arithmetic. Pure.
import type { accounting } from '@tasnivo/contracts';
import type { BankRecordPayload, ReconcileReport } from '@tasnivo/contracts/modules/bank';
import type { z } from 'zod';
import { formulaSafe } from '../csv-safe.js';
import { addDecimals, sameDecimal, subDecimals } from './decimal.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];

export type ReconcileRecord = {
  rowIndex: number;
  status: RecordStatus;
  payload: BankRecordPayload;
  issues: ValidationIssue[];
  note: string | null;
};

export type ReconcileHeader = {
  openingBalance: string | null;
  closingBalance: string | null;
  bankTotals: { debit: string | null; credit: string | null };
  dropped: { rowIndex: number; reason: string }[];
};

type Total = { key: string; count: number; debit: string; credit: string };

function tally(map: Map<string, Total>, key: string, payload: BankRecordPayload): void {
  const t = map.get(key) ?? { key, count: 0, debit: '0', credit: '0' };
  t.count++;
  if (payload.amount && payload.direction === 'debit') t.debit = addDecimals(t.debit, payload.amount);
  if (payload.amount && payload.direction === 'credit') t.credit = addDecimals(t.credit, payload.amount);
  map.set(key, t);
}

const lineText = (p: BankRecordPayload): string => [p.date ?? '', p.counterparty.name, p.purpose].filter(Boolean).join(' · ').slice(0, 300);

/**
 * Totals over every line with an amount and a direction, whatever its review status: the balance
 * check is about the file (did we read every payment the bank listed), not about what goes to 1C.
 */
export function reconcile(header: ReconcileHeader, records: readonly ReconcileRecord[]): Omit<ReconcileReport, 'statement'> {
  let totalDebit = '0';
  let totalCredit = '0';
  const byOperation = new Map<string, Total>();
  const byStatus = new Map<string, Total>();
  const unresolved: ReconcileReport['unresolved'] = [];
  const skipped: ReconcileReport['skipped'] = [];
  let exported = 0;
  for (const r of records) {
    const p = r.payload;
    if (p.amount && p.direction === 'debit') totalDebit = addDecimals(totalDebit, p.amount);
    if (p.amount && p.direction === 'credit') totalCredit = addDecimals(totalCredit, p.amount);
    tally(byOperation, p.operation ?? 'none', p);
    tally(byStatus, r.status, p);
    if (r.status === 'unresolved') unresolved.push({ rowIndex: r.rowIndex, codes: r.issues.filter((i) => i.severity === 'error').map((i) => i.code), text: lineText(p) });
    if (r.status === 'skipped') skipped.push({ rowIndex: r.rowIndex, note: r.note, text: lineText(p) });
    if (r.status === 'exported') exported++;
  }
  const computedClosing = header.openingBalance !== null ? subDecimals(addDecimals(header.openingBalance, totalCredit), totalDebit) : null;
  const difference = computedClosing !== null && header.closingBalance !== null ? subDecimals(computedClosing, header.closingBalance) : null;
  const matches = (bank: string | null, ours: string): boolean | null => (bank === null ? null : sameDecimal(bank, ours));
  return {
    openingBalance: header.openingBalance,
    closingBalance: header.closingBalance,
    totalDebit,
    totalCredit,
    computedClosing,
    difference,
    balanced: difference === null ? null : sameDecimal(difference, '0'),
    bankTotals: {
      debit: header.bankTotals.debit, credit: header.bankTotals.credit,
      debitMatches: matches(header.bankTotals.debit, totalDebit), creditMatches: matches(header.bankTotals.credit, totalCredit),
    },
    byOperation: [...byOperation.values()].sort((a, b) => b.count - a.count),
    byStatus: [...byStatus.values()].sort((a, b) => b.count - a.count),
    unresolved,
    skipped,
    dropped: header.dropped,
    exported,
  };
}

export type CsvLabels = {
  summary: string; opening: string; credits: string; debits: string; computed: string; closing: string; difference: string;
  columns: readonly string[];
  operation: (op: string | null) => string;
  status: (status: RecordStatus) => string;
  issue: (code: string) => string;
};

const cell = (value: string): string => {
  const safe = formulaSafe(value);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The report and every line as a ';' CSV with a BOM (opens in Excel in a RU/UZ locale as is). */
export function reconcileCsv(report: Omit<ReconcileReport, 'statement'>, records: readonly ReconcileRecord[], labels: CsvLabels): string {
  const rows: string[][] = [
    [labels.summary],
    [labels.opening, report.openingBalance ?? ''],
    [labels.credits, report.totalCredit],
    [labels.debits, report.totalDebit],
    [labels.computed, report.computedClosing ?? ''],
    [labels.closing, report.closingBalance ?? ''],
    [labels.difference, report.difference ?? ''],
    [],
    [...labels.columns],
  ];
  for (const r of [...records].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const p = r.payload;
    rows.push([
      String(r.rowIndex), p.date ?? '', p.docNumber ?? '', p.direction ?? '', p.amount ?? '', p.currency,
      p.counterparty.name, p.counterparty.inn ?? '', labels.operation(p.operation), labels.status(r.status),
      r.issues.map((i) => labels.issue(i.code)).join(', '), p.purpose,
    ]);
  }
  return `\ufeff${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

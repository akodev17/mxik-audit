// The validation issue codes a bank statement line can carry, their severity, and the record
// status they lead to. Every code has a uz and ru label in bankX.issues (i18n-parts/bank.ts;
// issues.test.ts checks). Pure; shared with the browser.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type Severity = ValidationIssue['severity'];
type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];

/** Code → severity. An error keeps the line unresolved; a warning makes it suspicious; info only explains. */
export const BANK_ISSUES = {
  date_missing: 'error',
  date_invalid: 'error',
  amount_missing: 'error',
  amount_invalid: 'error',
  amount_both_columns: 'error',
  amount_negative: 'error',
  direction_missing: 'error',
  amount_ambiguous: 'warning',
  inn_invalid: 'warning',
  account_invalid: 'warning',
  mfo_invalid: 'warning',
  counterparty_missing: 'warning',
  purpose_missing: 'warning',
  counterparty_unknown: 'warning',
  counterparty_ambiguous: 'warning',
  counterparty_new: 'info',
  operation_missing: 'warning',
  operation_suggested: 'info',
  duplicate_row: 'warning',
  duplicate_pending: 'info',
  currency_mismatch: 'warning',
} as const satisfies Record<string, Severity>;

export type BankIssueCode = keyof typeof BANK_ISSUES;
export const BANK_ISSUE_CODES = Object.keys(BANK_ISSUES) as BankIssueCode[];

export function issue(code: BankIssueCode, field?: string, params?: Record<string, string | number>, suggestion?: string): ValidationIssue {
  return {
    code, severity: BANK_ISSUES[code],
    ...(field ? { field } : {}),
    ...(params && Object.keys(params).length > 0 ? { params } : {}),
    ...(suggestion !== undefined ? { suggestion } : {}),
  };
}

/** The status a line's issues give it before any decision: unresolved on an error, suspicious on a warning. */
export function statusFromIssues(issues: readonly ValidationIssue[]): Extract<RecordStatus, 'valid' | 'suspicious' | 'unresolved'> {
  if (issues.some((i) => i.severity === 'error')) return 'unresolved';
  if (issues.some((i) => i.severity === 'warning')) return 'suspicious';
  return 'valid';
}

export const hasError = (issues: readonly ValidationIssue[]): boolean => issues.some((i) => i.severity === 'error');

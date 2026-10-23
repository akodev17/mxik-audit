// What the shared review grid shows of a record (docs/accounting-2026-10-23/onec-ui.md): the
// columns per batch kind, how a payload value reads, the status tones, and an issue code's label
// in whichever part of the dictionary defines it. Pure: the grid, the bank and Didox pages and
// the tests import it.
import type { accounting } from '@tasnivo/contracts';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { Tone } from '@/ui/badge';

export type ImportKind = (typeof accounting.IMPORT_KINDS)[number];
export type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];
export type ImportStatus = (typeof accounting.IMPORT_STATUSES)[number];

/**
 * One column of the grid. `key` is a dot path into the record's payload (`amount`,
 * `counterparty.inn`); `label` defaults to `ta.onecX.columns[<last segment>]`. An `editable` column
 * is offered in the record's correction form and sent as `corrections[key]`.
 */
export type ReviewColumn = {
  key: string;
  label?: string;
  /** `signed`: money with the sign of the payload's `direction` (− for a debit). */
  kind?: 'text' | 'money' | 'signed' | 'date' | 'code' | 'direction' | 'long';
  editable?: boolean;
  /** Hidden below the xl breakpoint (the first three columns always show). */
  wide?: boolean;
  /** Only in the correction form, not a grid column. */
  formOnly?: boolean;
};

export const DEFAULT_COLUMNS: Record<ImportKind, ReviewColumn[]> = {
  bank_statement: [
    { key: 'date', kind: 'date', editable: true },
    { key: 'amount', kind: 'signed', editable: true },
    { key: 'docNumber', kind: 'code', editable: true, formOnly: true },
    { key: 'counterparty.name', kind: 'text', editable: true },
    { key: 'counterparty.inn', kind: 'code', editable: true, wide: true },
    { key: 'purpose', kind: 'long', editable: true, wide: true },
    { key: 'operation', kind: 'text', editable: true, wide: true },
  ],
  didox_invoice: [
    { key: 'name', kind: 'text', editable: true },
    { key: 'mxik', kind: 'code', editable: true },
    { key: 'packageCode', kind: 'code', editable: true, wide: true },
    { key: 'unit', kind: 'text', wide: true },
    { key: 'quantity', kind: 'money', editable: true },
    { key: 'price', kind: 'money', editable: true, wide: true },
    { key: 'amount', kind: 'money', editable: true },
    { key: 'vatAmount', kind: 'money', wide: true },
    { key: 'total', kind: 'money', wide: true },
  ],
  product_catalog: [
    { key: 'name', kind: 'text', editable: true },
    { key: 'mxik', kind: 'code', editable: true },
    { key: 'packageCode', kind: 'code', editable: true },
    { key: 'unit', kind: 'text', editable: true, wide: true },
    { key: 'barcode', kind: 'code', editable: true, wide: true },
    { key: 'mxikStatus', kind: 'text', wide: true },
  ],
};

/** The value at a dot path of a payload, or undefined. */
export function valueAt(payload: Record<string, unknown>, path: string): unknown {
  let node: unknown = payload;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** "1500000.5" → "1 500 000,50" (ru) / "1 500 000.50" (uz); anything else as it is. */
export function moneyText(value: unknown, locale: 'uz' | 'ru'): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value);
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const whole = (m[2] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const fraction = (m[3] ?? '').padEnd(2, '0');
  return `${m[1] ?? ''}${whole}${locale === 'ru' ? ',' : '.'}${fraction}`;
}

/** A payload value as text: scalars as they are, anything else as JSON. */
export function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** YYYY-MM-DD → DD.MM.YYYY. */
export function dateText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

export function cellText(column: ReviewColumn, payload: Record<string, unknown>, locale: 'uz' | 'ru', directions: Record<string, string>): string {
  const value = valueAt(payload, column.key);
  if (value === null || value === undefined) return '';
  switch (column.kind) {
    case 'money': return moneyText(value, locale);
    case 'signed': return `${valueAt(payload, 'direction') === 'debit' ? '−' : '+'}${moneyText(value, locale)}`;
    case 'date': return dateText(value);
    case 'direction': return directions[scalarText(value)] ?? scalarText(value);
    default: return scalarText(value);
  }
}

export const columnLabel = (column: ReviewColumn, labels: Record<string, string>): string =>
  column.label ?? labels[column.key] ?? labels[column.key.split('.').at(-1) ?? column.key] ?? column.key;

export const RECORD_TONE: Record<RecordStatus, Tone> = {
  valid: 'good', corrected: 'info', suspicious: 'warn', unresolved: 'danger', skipped: 'neutral', exported: 'brand',
};

export const BATCH_TONE: Record<ImportStatus, Tone> = {
  uploaded: 'neutral', parsed: 'info', review: 'warn', approved: 'good', exported: 'brand', failed: 'danger',
};

/**
 * An issue code's label: the shared ones (`accountingX.issues`) first, then each workstream's own
 * part (`bankX.issues`, `didoxX.issues`, `productsX.issues`), else the code itself.
 */
export function issueLabel(ta: AppDict, code: string): string {
  const parts = ta as unknown as Record<string, { issues?: Record<string, unknown> } | undefined>;
  for (const area of ['accountingX', 'bankX', 'didoxX', 'productsX', 'onecX']) {
    const label = parts[area]?.issues?.[code];
    if (typeof label === 'string') return label;
  }
  return code;
}

/** An issue's params as one line ("expected 27 944 400, actual 27 944 500"), without the record id. */
export function issueDetail(params: Record<string, string | number> | undefined): string {
  if (!params) return '';
  return Object.entries(params).filter(([k]) => k !== 'recordId' && k !== 'row').map(([k, v]) => `${k}: ${v}`).join(' · ');
}

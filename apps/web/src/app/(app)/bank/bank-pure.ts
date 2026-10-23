// Browser copies of pure rules from packages/domain/src/bank (the web app does not import the
// domain): what a column mapping lacks, which direction convention its columns allow, and the
// money format of the screens. tests/web-parity/bank.test.ts holds them to the originals.
import type { BankColumnMap, BankConventions, BankRole } from '@tasnivo/contracts/modules/bank';

type Tone = 'neutral' | 'danger' | 'warn' | 'good' | 'brand' | 'info';

/** Statement (batch) status → chip tone. */
export const STATUS_TONE: Record<string, Tone> = { uploaded: 'info', parsed: 'info', review: 'warn', approved: 'good', exported: 'good', failed: 'danger' };
/** Line (record) status → chip tone. */
export const RECORD_TONE: Record<string, Tone> = { valid: 'good', corrected: 'info', suspicious: 'warn', unresolved: 'danger', skipped: 'neutral', exported: 'brand' };

const columnOf = (map: BankColumnMap, role: BankRole): number => map[role] ?? -1;

/** formats/index.ts mappingProblem. */
export function mappingProblem(map: BankColumnMap, conventions: BankConventions): 'date' | 'amount' | 'direction' | null {
  if (columnOf(map, 'date') < 0) return 'date';
  if (conventions.direction === 'columns') return columnOf(map, 'debit') >= 0 && columnOf(map, 'credit') >= 0 ? null : 'amount';
  if (columnOf(map, 'amount') < 0) return 'amount';
  if (conventions.direction === 'flag' && columnOf(map, 'direction') < 0) return 'direction';
  return null;
}

/** formats/index.ts directionFor. */
export function directionFor(map: BankColumnMap, preferred: BankConventions['direction']): BankConventions['direction'] {
  if (columnOf(map, 'debit') >= 0 && columnOf(map, 'credit') >= 0) return 'columns';
  if (columnOf(map, 'amount') >= 0) return columnOf(map, 'direction') >= 0 && preferred !== 'signed' ? 'flag' : 'signed';
  return preferred;
}

/** decimal.ts formatDecimal: grouped whole part, at least two fraction digits. */
export function formatDecimal(value: string, group = ' ', mark = '.'): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? '-' : ''}${grouped}${mark}${fraction.padEnd(2, '0')}`;
}

/** Money as the screens show it: "1 234 567,89" in both locales (how Uzbek and Russian banks print it). */
export const money = (value: string | null | undefined): string => (value ? formatDecimal(value, ' ', ',') : '—');

/** The roles in the order the mapping step lists them. */
export const ROLE_ORDER: readonly BankRole[] = ['date', 'docNumber', 'debit', 'credit', 'amount', 'direction', 'counterpartyName', 'inn', 'account', 'mfo', 'purpose', 'reference', 'currency'];

/** "rule:builtin:tax" / "rule:<id>" / "manual" / "ai" → what decided the operation, for the badge. */
export function decidedKind(decidedBy: string | null): { kind: 'builtin' | 'rule' | 'manual' | 'ai'; name: string | null } | null {
  if (!decidedBy) return null;
  if (decidedBy.startsWith('rule:builtin:')) return { kind: 'builtin', name: decidedBy.slice('rule:builtin:'.length) };
  if (decidedBy.startsWith('rule:')) return { kind: 'rule', name: null };
  if (decidedBy === 'manual') return { kind: 'manual', name: null };
  if (decidedBy === 'ai') return { kind: 'ai', name: null };
  return null;
}

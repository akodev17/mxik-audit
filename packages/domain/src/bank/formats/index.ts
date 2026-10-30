// Statement layouts: the registry of built-in layouts, recognition of a file's layout from its
// header row, the mapping guess for an unrecognised file, and the header signature an org's saved
// mapping is keyed by. Pure; shared with the browser.
import type { BankColumnMap, BankConventions, BankRole } from '@tasnivo/contracts/modules/bank';
import { bankHeaderKey, resolveColumns } from '../vocabulary.js';
import { BUILT_IN_FORMATS } from './builtin.js';
import type { BankFormatDef } from './types.js';

export { BUILT_IN_FORMATS } from './builtin.js';
export type { BankFormatDef } from './types.js';

export const builtInFormat = (id: string): BankFormatDef | undefined => BUILT_IN_FORMATS.find((f) => f.id === id);

/** The mapping in BankColumnMap form: every role present, -1 where the file has no such column. */
export function toColumnMap(resolved: Partial<Record<BankRole, number>>): BankColumnMap {
  return {
    date: resolved.date ?? -1, docNumber: resolved.docNumber ?? -1, debit: resolved.debit ?? -1, credit: resolved.credit ?? -1,
    amount: resolved.amount ?? -1, direction: resolved.direction ?? -1, counterpartyName: resolved.counterpartyName ?? -1,
    inn: resolved.inn ?? -1, account: resolved.account ?? -1, mfo: resolved.mfo ?? -1, purpose: resolved.purpose ?? -1,
    reference: resolved.reference ?? -1, currency: resolved.currency ?? -1, ownAccount: resolved.ownAccount ?? -1,
    valueDate: resolved.valueDate ?? -1, purposeCode: resolved.purposeCode ?? -1,
  };
}

/** Column index of a role, -1 when absent. */
export const columnOf = (map: BankColumnMap, role: BankRole): number => map[role] ?? -1;

/** Placeholder names the sheet reader gives columns without a header (sheet-shape.ts columnName). */
const PLACEHOLDER = /^ustun \d+$/;

/**
 * The header signature a saved layout is keyed by: every header's key in column order, joined
 * with '|'. Two files of one bank export share it; a different bank (or a changed export) does not.
 */
export function headerSignature(headers: readonly string[]): string {
  return headers.map((h) => bankHeaderKey(h)).map((k) => (PLACEHOLDER.test(k) ? '' : k)).join('|').replace(/\|+$/, '');
}

/** The direction convention the columns allow: two amount columns, an amount with a flag column, or a signed amount. */
export function directionFor(map: BankColumnMap, preferred: BankConventions['direction']): BankConventions['direction'] {
  if (columnOf(map, 'debit') >= 0 && columnOf(map, 'credit') >= 0) return 'columns';
  if (columnOf(map, 'amount') >= 0) return columnOf(map, 'direction') >= 0 && preferred !== 'signed' ? 'flag' : 'signed';
  return preferred;
}

/** Roles the format's words find, then any role still missing from the common vocabulary on the columns left. */
function mapWith(format: BankFormatDef, headers: readonly string[]): { resolved: Partial<Record<BankRole, number>>; own: number } {
  const resolved = resolveColumns(headers, format.columns);
  const own = Object.keys(resolved).length;
  const taken = new Set(Object.values(resolved));
  const rest = resolveColumns(headers.map((h, i) => (taken.has(i) ? '' : h)));
  for (const [role, column] of Object.entries(rest) as [BankRole, number][]) {
    if (resolved[role] === undefined) resolved[role] = column;
  }
  return { resolved, own };
}

export type Detected = { format: BankFormatDef; columnMap: BankColumnMap; conventions: BankConventions };

/**
 * The built-in layout this header row belongs to: every required role found with the layout's own
 * words; the layout whose words find the most columns wins. Null = unrecognised (manual mapping).
 */
export function detectFormat(headers: readonly string[], formats: readonly BankFormatDef[] = BUILT_IN_FORMATS): Detected | null {
  let best: { def: BankFormatDef; resolved: Partial<Record<BankRole, number>>; own: number } | null = null;
  for (const def of formats) {
    if (def.detect === false) continue;
    const { resolved, own } = mapWith(def, headers);
    const ownOnly = resolveColumns(headers, def.columns);
    if (!def.required.every((role) => ownOnly[role] !== undefined)) continue;
    if (!best || own > best.own) best = { def, resolved, own };
  }
  return best ? detected(best.def, best.resolved) : null;
}

function detected(format: BankFormatDef, resolved: Partial<Record<BankRole, number>>): Detected {
  const columnMap = toColumnMap(resolved);
  return { format, columnMap, conventions: { ...format.conventions, direction: directionFor(columnMap, format.conventions.direction) } };
}

/** A built-in layout the reader chose itself (a converted kl_to_1c or payer/payee file), mapped onto these headers. */
export function layoutFor(formatId: string, headers: readonly string[]): Detected | null {
  const format = builtInFormat(formatId);
  return format ? detected(format, mapWith(format, headers).resolved) : null;
}

/** The mapping guess for an unrecognised file: the common vocabulary, the direction the columns allow. */
export function guessMapping(headers: readonly string[]): { columnMap: BankColumnMap; conventions: BankConventions } {
  const columnMap = toColumnMap(resolveColumns(headers));
  return { columnMap, conventions: { dateOrder: 'dmy', decimal: 'auto', direction: directionFor(columnMap, 'columns'), negativeIs: 'debit', currency: 'UZS' } };
}

/** What a mapping must have to read amounts: a date, and two amount columns, or one amount (signed or with a flag column). */
export function mappingProblem(map: BankColumnMap, conventions: BankConventions): 'date' | 'amount' | 'direction' | null {
  if (columnOf(map, 'date') < 0) return 'date';
  if (conventions.direction === 'columns') return columnOf(map, 'debit') >= 0 && columnOf(map, 'credit') >= 0 ? null : 'amount';
  if (columnOf(map, 'amount') < 0) return 'amount';
  if (conventions.direction === 'flag' && columnOf(map, 'direction') < 0) return 'direction';
  return null;
}

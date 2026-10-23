// A located statement table → normalised lines (BankRecordPayload + ValidationIssue[]), the rows
// left out with their reason, and the statement header (BankStatementMeta). A line the parser
// cannot decide keeps the undecidable field null and an error issue: it is unresolved, never
// guessed. Pure; the store runs it before matching and rules.
import type { accounting } from '@tasnivo/contracts';
import type { BankColumnMap, BankConventions, BankRecordPayload, BankRole } from '@tasnivo/contracts/modules/bank';
import type { z } from 'zod';
import { repeatsHeader } from '../sheet-shape.js';
import { readDate } from './dates.js';
import { absDecimal, addDecimals, isNegativeDecimal, isZeroDecimal, readDecimal, type DecimalRead } from './decimal.js';
import { columnOf } from './formats/index.js';
import { readAccount, readDirectionFlag, readInn, readMfo } from './identifiers.js';
import { issue } from './issues.js';
import { isColumnNumbers, readTitle, rowNoise, type StatementSheet, type TitleInfo } from './sheet.js';
import { CURRENCY_WORDS, type NoiseKind } from './vocabulary.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type BankStatementMeta = z.infer<typeof accounting.BankStatementMeta>;

export type DropReason = NoiseKind | 'repeated_header' | 'column_numbers' | 'continuation' | 'no_amount' | 'layout_row';
export const DROP_REASONS: readonly DropReason[] = ['opening_balance', 'closing_balance', 'balance', 'totals', 'footer', 'repeated_header', 'column_numbers', 'continuation', 'no_amount', 'layout_row'];

export type DroppedLine = { rowIndex: number; reason: DropReason; text: string };
export type StatementLine = { rowIndex: number; payload: BankRecordPayload; issues: ValidationIssue[] };

/** Header details beyond BankStatementMeta that the review and reconciliation screens show. */
export type StatementExtra = {
  formatName: string;
  formatVerified: boolean;
  signature: string;
  headerRow: number;
  titleLines: string[];
  ownInn: string | null;
  ownName: string | null;
  /** The bank's own totals row, when the file has one. */
  bankTotals: { debit: string | null; credit: string | null };
  currencySource: TitleInfo['currencySource'] | 'column' | 'default';
  totalRows: number;
  truncated: boolean;
};

export type ParsedStatement = { meta: BankStatementMeta; extra: StatementExtra; lines: StatementLine[]; dropped: DroppedLine[] };

export type ParseOptions = {
  columnMap: BankColumnMap;
  conventions: BankConventions;
  formatId: string;
  formatName: string;
  verified: boolean;
  signature: string;
  /** Layout-specific rows to leave out (BankFormatDef.dropRows). */
  dropRows?: readonly RegExp[];
};

const MAX_DROPPED_IN_META = 200;

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
const textOf = (cells: readonly string[]): string => cut(cells.filter(Boolean).join(' · '), 300);

/**
 * Contract reference named in a purpose ("Договор 4/28 от 01.01.2026г", "shartnoma № 15 dan
 * 02.03.2026"), as written; null when the purpose names none.
 */
export function contractIn(purpose: string): string | null {
  const m = /(?:договор[уа]?|дог\.|shartnoma|шартнома|contract)\s*(?:№|n|no\.?|#)?\s*([\p{L}\p{N}][\p{L}\p{N}\-/.]*)(?:\s*(?:от|dan|sana)\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4}))?/iu.exec(purpose);
  if (!m?.[1]) return null;
  return cut(m[2] ? `${m[1]} от ${m[2]}` : m[1], 120);
}

function currencyCode(raw: string): string | null {
  const text = raw.trim();
  if (/^[A-Z]{3}$/.test(text)) return text;
  return CURRENCY_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** The first amount a balance or totals row carries: in the amount columns, else the last number in the row. */
function rowAmount(cells: readonly string[], map: BankColumnMap, conventions: BankConventions): string | null {
  for (const role of ['amount', 'credit', 'debit'] as const) {
    const at = columnOf(map, role);
    const read = at >= 0 ? readDecimal(cells[at], conventions.decimal) : null;
    if (read?.value && !isZeroDecimal(read.value)) return read.value;
  }
  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i] ?? '';
    if (!/\d/.test(cell) || readDate(cell, conventions.dateOrder).value) continue;
    const read = readDecimal(cell.replace(/^.*:/, ''), conventions.decimal);
    if (read.value) return read.value;
  }
  return null;
}

type Amounts = { amount: string | null; direction: 'debit' | 'credit' | null; issues: ValidationIssue[] };

function amountIssue(read: DecimalRead, raw: string, field: string): ValidationIssue[] {
  if (read.invalid) return [issue('amount_invalid', 'amount', { value: cut(raw, 40), column: field })];
  if (read.ambiguous) return [issue('amount_ambiguous', 'amount', { value: cut(raw, 40) })];
  return [];
}

/** Amount and direction by the file's convention. Zero in the other column is the usual "0,00", not an amount. */
function readAmounts(cells: readonly string[], map: BankColumnMap, conventions: BankConventions): Amounts {
  const cell = (role: BankRole): string => {
    const at = columnOf(map, role);
    return at >= 0 ? (cells[at] ?? '') : '';
  };
  if (conventions.direction === 'columns') {
    const dRaw = cell('debit');
    const cRaw = cell('credit');
    const d = readDecimal(dRaw, conventions.decimal);
    const c = readDecimal(cRaw, conventions.decimal);
    const issues = [...amountIssue(d, dRaw, 'debit'), ...amountIssue(c, cRaw, 'credit')];
    if (d.invalid || c.invalid) return { amount: null, direction: null, issues };
    const dSet = d.value !== null && !isZeroDecimal(d.value);
    const cSet = c.value !== null && !isZeroDecimal(c.value);
    if (dSet && cSet) return { amount: null, direction: null, issues: [...issues, issue('amount_both_columns', 'amount', { debit: d.value ?? '', credit: c.value ?? '' })] };
    if (!dSet && !cSet) return { amount: null, direction: null, issues: [...issues, issue('amount_missing', 'amount')] };
    const value = (dSet ? d.value : c.value) ?? '0';
    if (isNegativeDecimal(value)) return { amount: null, direction: null, issues: [...issues, issue('amount_negative', 'amount', { value })] };
    return { amount: value, direction: dSet ? 'debit' : 'credit', issues };
  }
  const raw = cell('amount');
  const read = readDecimal(raw, conventions.decimal);
  const issues = amountIssue(read, raw, 'amount');
  if (read.invalid) return { amount: null, direction: null, issues };
  if (read.value === null || isZeroDecimal(read.value)) return { amount: null, direction: null, issues: [...issues, issue('amount_missing', 'amount')] };
  if (conventions.direction === 'signed') {
    const negative = isNegativeDecimal(read.value);
    const direction = negative ? conventions.negativeIs : conventions.negativeIs === 'debit' ? 'credit' : 'debit';
    return { amount: absDecimal(read.value), direction, issues };
  }
  const flagRaw = cell('direction');
  const direction = readDirectionFlag(flagRaw);
  if (isNegativeDecimal(read.value)) return { amount: null, direction, issues: [...issues, issue('amount_negative', 'amount', { value: read.value })] };
  if (!direction) return { amount: read.value, direction: null, issues: [...issues, issue('direction_missing', 'direction', { value: cut(flagRaw, 40) })] };
  return { amount: read.value, direction, issues };
}

function buildLine(row: { line: number; cells: string[] }, options: ParseOptions, title: TitleInfo, currency: string): StatementLine {
  const { columnMap: map, conventions } = options;
  const cell = (role: BankRole): string => {
    const at = columnOf(map, role);
    return at >= 0 ? (row.cells[at] ?? '').trim() : '';
  };
  const issues: ValidationIssue[] = [];

  const dateRaw = cell('date');
  const date = readDate(dateRaw, conventions.dateOrder);
  if (!date.value) issues.push(date.invalid ? issue('date_invalid', 'date', { value: cut(dateRaw, 40) }) : issue('date_missing', 'date'));

  const amounts = readAmounts(row.cells, map, conventions);
  issues.push(...amounts.issues);

  const innRaw = cell('inn');
  const inn = readInn(innRaw);
  if (inn.invalid) issues.push(issue('inn_invalid', 'counterparty.inn', { value: cut(innRaw, 40) }));
  const accountRaw = cell('account');
  const account = readAccount(accountRaw);
  if (account.invalid) issues.push(issue('account_invalid', 'counterparty.account', { value: cut(accountRaw, 40) }));
  const mfoRaw = cell('mfo');
  const mfo = readMfo(mfoRaw);
  if (mfo.invalid) issues.push(issue('mfo_invalid', 'counterparty.mfo', { value: cut(mfoRaw, 40) }));

  const name = cut(cell('counterpartyName'), 300);
  if (!name && !inn.value) issues.push(issue('counterparty_missing', 'counterparty.name'));
  const purpose = cut(cell('purpose'), 2000);
  if (!purpose) issues.push(issue('purpose_missing', 'purpose'));

  const currencyRaw = cell('currency');
  const lineCurrency = currencyRaw ? currencyCode(currencyRaw) : null;
  if (lineCurrency && lineCurrency !== currency) issues.push(issue('currency_mismatch', 'currency', { line: lineCurrency, statement: currency }));

  const payload: BankRecordPayload = {
    date: date.value,
    docNumber: cut(cell('docNumber'), 40) || null,
    direction: amounts.direction,
    amount: amounts.amount,
    currency: lineCurrency ?? currency,
    ourAccount: title.account,
    counterparty: { name, inn: inn.value, account: account.value, mfo: mfo.value, counterpartyId: null },
    purpose,
    reference: cut(cell('reference'), 80) || null,
    valueDate: null,
    operation: null,
    cashFlowItem: null,
    contract: contractIn(purpose),
    decidedBy: null,
    raw: row.cells.slice(0, 60).map((c) => cut(c, 500)),
    operationSuggestion: null,
  };
  return { rowIndex: row.line, payload, issues };
}

/**
 * Reads every body row: a dated row is a line; an undated row is a balance, totals, footer or
 * layout row when its text says so, a continuation of the previous line's purpose when it only
 * carries text, and otherwise a line with `date_missing` (unresolved).
 */
export function parseStatement(sheet: StatementSheet, options: ParseOptions): ParsedStatement {
  const { columnMap: map, conventions } = options;
  const title = readTitle(sheet.titleRows, conventions.dateOrder);
  const currencyColumn = columnOf(map, 'currency');
  const currency = title.currency ?? conventions.currency;
  let currencySource: StatementExtra['currencySource'] = title.currencySource ?? 'default';

  const lines: StatementLine[] = [];
  const dropped: DroppedLine[] = [];
  let opening: string | null = null;
  let closing: string | null = null;
  const bankTotals: StatementExtra['bankTotals'] = { debit: null, credit: null };
  // Some banks print the balances above the table ("Входящий остаток: 12 345,67").
  for (const cells of sheet.titleRows) {
    const kind = rowNoise(cells);
    if (kind === 'opening_balance' && opening === null) opening = rowAmount(cells, { date: -1 }, conventions);
    if (kind === 'closing_balance' && closing === null) closing = rowAmount(cells, { date: -1 }, conventions);
  }
  const amountColumns = (['debit', 'credit', 'amount'] as const).map((r) => columnOf(map, r)).filter((c) => c >= 0);
  const textColumns = (['purpose', 'counterpartyName'] as const).map((r) => columnOf(map, r)).filter((c) => c >= 0);

  for (const row of sheet.body) {
    const drop = (reason: DropReason): void => { dropped.push({ rowIndex: row.line, reason, text: textOf(row.cells) }); };
    if (repeatsHeader(row.cells, sheet.headerCells) || (sheet.subHeaderCells.length > 0 && repeatsHeader(row.cells, sheet.subHeaderCells))) { drop('repeated_header'); continue; }
    if (isColumnNumbers(row.cells)) { drop('column_numbers'); continue; }
    const dateCell = row.cells[columnOf(map, 'date')] ?? '';
    const dated = readDate(dateCell, conventions.dateOrder).value !== null;
    if (!dated) {
      const kind = rowNoise(row.cells);
      if (kind) {
        if (kind === 'opening_balance' && opening === null) opening = rowAmount(row.cells, map, conventions);
        if (kind === 'closing_balance') closing = rowAmount(row.cells, map, conventions) ?? closing;
        if (kind === 'totals' && bankTotals.debit === null && bankTotals.credit === null) {
          const at = (role: 'debit' | 'credit'): string | null => {
            const c = columnOf(map, role);
            return c >= 0 ? readDecimal(row.cells[c], conventions.decimal).value : null;
          };
          bankTotals.debit = at('debit');
          bankTotals.credit = at('credit');
        }
        drop(kind);
        continue;
      }
      const text = row.cells.filter(Boolean).join(' ').toLowerCase();
      if (options.dropRows?.some((p) => p.test(text))) { drop('layout_row'); continue; }
      const hasAmount = amountColumns.some((c) => (row.cells[c] ?? '').trim() !== '');
      if (!hasAmount) {
        const previous = lines[lines.length - 1];
        const onlyText = row.cells.every((c, i) => c.trim() === '' || textColumns.includes(i));
        if (previous && onlyText && textColumns.length > 0) {
          const more = textColumns.map((c) => row.cells[c]?.trim() ?? '').filter(Boolean).join(' ');
          previous.payload.purpose = cut(`${previous.payload.purpose} ${more}`.trim(), 2000);
          if (previous.payload.purpose) previous.issues = previous.issues.filter((i) => i.code !== 'purpose_missing');
          previous.payload.contract ??= contractIn(previous.payload.purpose);
          drop('continuation');
        } else drop('no_amount');
        continue;
      }
    }
    const line = buildLine(row, options, title, currency);
    if (currencyColumn >= 0 && line.payload.currency !== currency) currencySource = 'column';
    lines.push(line);
  }

  let totalDebit = '0';
  let totalCredit = '0';
  const dates: string[] = [];
  for (const { payload } of lines) {
    if (payload.date) dates.push(payload.date);
    if (!payload.amount || !payload.direction) continue;
    if (payload.direction === 'debit') totalDebit = addDecimals(totalDebit, payload.amount);
    else totalCredit = addDecimals(totalCredit, payload.amount);
  }
  dates.sort();

  const meta: BankStatementMeta = {
    formatId: options.formatId,
    bankName: title.bankName,
    account: title.account,
    currency,
    periodFrom: title.periodFrom ?? dates[0] ?? null,
    periodTo: title.periodTo ?? dates[dates.length - 1] ?? null,
    openingBalance: opening,
    closingBalance: closing,
    totalDebit,
    totalCredit,
    headers: sheet.headers,
    columnMap: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v ?? -1])),
    dropped: dropped.slice(0, MAX_DROPPED_IN_META).map(({ rowIndex, reason }) => ({ rowIndex, reason })),
  };
  const extra: StatementExtra = {
    formatName: options.formatName, formatVerified: options.verified, signature: options.signature,
    headerRow: sheet.headerRow, titleLines: sheet.titleLines.slice(0, 12), ownInn: title.ownInn, ownName: title.ownName,
    bankTotals, currencySource, totalRows: sheet.body.length + sheet.extra, truncated: sheet.extra > 0,
  };
  return { meta, extra, lines, dropped };
}

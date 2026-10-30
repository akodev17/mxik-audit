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
import { balancesUnderLabels, isColumnNumbers, readTitle, rowNoise, type PrintedAccount, type StatementSheet, type TitleInfo } from './sheet.js';
import { CURRENCY_WORDS, type NoiseKind } from './vocabulary.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type BankStatementMeta = z.infer<typeof accounting.BankStatementMeta>;

export type DropReason = NoiseKind | 'repeated_header' | 'column_numbers' | 'continuation' | 'no_amount' | 'layout_row';
export const DROP_REASONS: readonly DropReason[] = ['opening_balance', 'closing_balance', 'balance', 'subtotals', 'totals', 'footer', 'repeated_header', 'column_numbers', 'continuation', 'no_amount', 'layout_row'];

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
  /** The lines' own sums (meta.totalDebit / totalCredit are the bank's printed ones, B6). */
  lineTotals: { debit: string; credit: string };
  /**
   * Per own account: what the bank printed (kl_to_1c СекцияРасчСчет) beside what the lines add up to.
   * Absent on statements read before 30 Oct 2026.
   */
  accounts?: AccountSummary[];
  currencySource: TitleInfo['currencySource'] | 'column' | 'default';
  totalRows: number;
  truncated: boolean;
};

/**
 * BankStatementMeta plus the statement owner's side of each payment (ownerName, ownerInn, mfo), which
 * the 1C layer added to the shared meta on its branch (side-session note agent1-onec-interface.md).
 */
export type StatementMeta = BankStatementMeta & { ownerName: string | null; ownerInn: string | null; mfo: string | null };

export type AccountSummary = PrintedAccount & { lines: number; lineDebit: string; lineCredit: string };

export type ParsedStatement = { meta: StatementMeta; extra: StatementExtra; lines: StatementLine[]; dropped: DroppedLine[] };

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
  // The word ends where its letters end ("по договору" alone names no contract: the real odin_palace
  // samples read "у" as the number before), and a contract number carries a digit.
  const m = /(?:договор[уа]?|дог\.|shartnoma|шартнома|contract)(?!\p{L})\s*(?:№|n|no\.?|#)?\s*([\p{L}\p{N}\-/.]*\d[\p{L}\p{N}\-/.]*)(?:\s*(?:от|dan|sana)\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4}))?/iu.exec(purpose);
  if (!m?.[1]) return null;
  return cut(m[2] ? `${m[1]} от ${m[2]}` : m[1], 120);
}

/**
 * The 5-digit CBU payment-purpose code (bank research §7.38): its own column (an Excel number cell
 * loses the leading zeros, so 1–5 digits are padded back), else five digits opening the purpose
 * ("00664 Оплата за консалтинг"). Not checked against the CBU table: it is not public in a usable form.
 */
export function purposeCodeOf(column: string, purpose: string): string | null {
  const raw = column.replace(/\s/g, '');
  if (/^\d{1,5}$/.test(raw) && !/^0+$/.test(raw)) return raw.padStart(5, '0');
  const lead = /^\s*(\d{5})(?:\s*[-–:;.)]\s*|\s+)(?=\S)/.exec(purpose);
  return lead?.[1] && !/^0+$/.test(lead[1]) ? lead[1] : null;
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
    if (!dSet && !cSet) {
      // A file that names the amount but not its side (a kl_to_1c document of neither own account).
      const loose = readDecimal(cell('amount'), conventions.decimal);
      if (loose.value && !isZeroDecimal(loose.value)) return { amount: absDecimal(loose.value), direction: null, issues: [...issues, issue('direction_missing', 'direction', { value: '' })] };
      return { amount: null, direction: null, issues: [...issues, ...amountIssue(loose, cell('amount'), 'amount'), issue('amount_missing', 'amount')] };
    }
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

  // The document date; a posting date alone stands in for it (bank research §7.34).
  const posted = readDate(cell('valueDate'), conventions.dateOrder).value;
  const dateRaw = cell('date') || cell('valueDate');
  const date = readDate(dateRaw, conventions.dateOrder);
  if (!date.value) issues.push(date.invalid ? issue('date_invalid', 'date', { value: cut(dateRaw, 40) }) : issue('date_missing', 'date'));
  const own = readAccount(cell('ownAccount'));

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
    ourAccount: own.value ?? title.account,
    counterparty: { name, inn: inn.value, account: account.value, mfo: mfo.value, counterpartyId: null },
    purpose,
    reference: cut(cell('reference'), 80) || null,
    valueDate: posted && posted !== date.value ? posted : null,
    purposeCode: purposeCodeOf(cell('purposeCode'), purpose),
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
  const underLabels = balancesUnderLabels(sheet.titleRows, conventions.dateOrder);
  opening ??= underLabels.opening;
  closing ??= underLabels.closing;
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
        if (kind === 'totals') readTotals(row.cells, map, conventions, bankTotals);
        drop(kind);
        continue;
      }
      const text = row.cells.filter(Boolean).join(' ').toLowerCase();
      if (options.dropRows?.some((p) => p.test(text))) { drop('layout_row'); continue; }
      const hasAmount = amountColumns.some((c) => (row.cells[c] ?? '').trim() !== '');
      if (!hasAmount) {
        const previous = lines[lines.length - 1];
        const filledCells = row.cells.filter((c) => c.trim() !== '');
        const onlyText = row.cells.every((c, i) => c.trim() === '' || textColumns.includes(i))
          || (filledCells.length === 1 && readDecimal(filledCells[0]).value === null);
        if (previous && onlyText && textColumns.length > 0) {
          const more = filledCells.map((c) => c.trim()).join(' ');
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

  const accounts = accountSummaries(lines, sheet.accounts ?? [], title.account);
  const single = accounts.length === 1 ? accounts[0] : undefined;
  if (single && sheet.accounts?.length) {
    opening ??= single.opening;
    closing ??= single.closing;
    if (bankTotals.debit === null && bankTotals.credit === null) { bankTotals.debit = single.debit; bankTotals.credit = single.credit; }
  }
  const printedFrom = (sheet.accounts ?? []).map((a) => a.periodFrom).filter((d): d is string => d !== null).sort()[0] ?? null;
  const printedTo = (sheet.accounts ?? []).map((a) => a.periodTo).filter((d): d is string => d !== null).sort().at(-1) ?? null;

  const meta: StatementMeta = {
    formatId: options.formatId,
    bankName: title.bankName,
    ownerName: title.ownName,
    ownerInn: title.ownInn,
    mfo: title.mfo,
    account: title.account ?? accounts[0]?.account ?? null,
    currency,
    periodFrom: title.periodFrom ?? printedFrom ?? dates[0] ?? null,
    periodTo: title.periodTo ?? printedTo ?? dates[dates.length - 1] ?? null,
    openingBalance: opening,
    closingBalance: closing,
    // B6: the totals the bank printed (its totals row, or the kl_to_1c turnovers); null when it printed none.
    // The lines' own sums are extra.lineTotals; the reconcile compares the two.
    totalDebit: bankTotals.debit,
    totalCredit: bankTotals.credit,
    headers: sheet.headers,
    columnMap: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v ?? -1])),
    dropped: dropped.slice(0, MAX_DROPPED_IN_META).map(({ rowIndex, reason }) => ({ rowIndex, reason })),
  };
  const extra: StatementExtra = {
    formatName: options.formatName, formatVerified: options.verified, signature: options.signature,
    headerRow: sheet.headerRow, titleLines: sheet.titleLines.slice(0, 12), ownInn: title.ownInn, ownName: title.ownName,
    bankTotals, lineTotals: { debit: totalDebit, credit: totalCredit }, ...(accounts.length > 1 || sheet.accounts?.length ? { accounts } : {}),
    currencySource, totalRows: sheet.body.length + sheet.extra, truncated: sheet.extra > 0,
  };
  return { meta, extra, lines, dropped };
}

/** The side a totals row names alone ("Обороты по расходу:"), or null for a row with both turnovers. */
function totalsSide(text: string): 'debit' | 'credit' | null {
  const lower = text.toLowerCase();
  const debit = /расход|дебет|списан|debet|chiqim|чиқим/u.test(lower);
  const credit = /приход|кредит|поступ|kredit|kirim|кирим/u.test(lower);
  return debit === credit ? null : debit ? 'debit' : 'credit';
}

/**
 * A totals row into the bank's totals (B6): "Итого обороты" with both turnovers in the debit and
 * credit columns, or one row per side ("Обороты по расходу: 1 734.00", Colvir). A later totals row
 * replaces an earlier one (page totals not marked as such end with the statement's own).
 */
function readTotals(cells: readonly string[], map: BankColumnMap, conventions: BankConventions, totals: StatementExtra['bankTotals']): void {
  const side = totalsSide(cells.filter(Boolean).join(' '));
  if (side) {
    const value = rowAmount(cells, map, conventions) ?? (cells.some((c) => /^0([.,]0+)?$/.test(c.trim())) ? '0' : null);
    if (value !== null) totals[side] = value;
    return;
  }
  const at = (role: 'debit' | 'credit'): string | null => {
    const c = columnOf(map, role);
    return c >= 0 ? readDecimal(cells[c], conventions.decimal).value : null;
  };
  const debit = at('debit');
  const credit = at('credit');
  if (debit !== null || credit !== null) { totals.debit = debit; totals.credit = credit; }
}

/** One summary per own account: the printed balances (when the file states them) and the lines' sums. */
function accountSummaries(lines: readonly StatementLine[], printed: readonly PrintedAccount[], titleAccount: string | null): AccountSummary[] {
  const out = new Map<string, AccountSummary>();
  const empty = (account: string): AccountSummary => ({ account, periodFrom: null, periodTo: null, opening: null, closing: null, debit: null, credit: null, lines: 0, lineDebit: '0', lineCredit: '0' });
  for (const p of printed) out.set(p.account, { ...empty(p.account), ...p });
  for (const { payload } of lines) {
    const account = payload.ourAccount ?? titleAccount ?? '';
    if (!account) continue;
    const s = out.get(account) ?? empty(account);
    s.lines++;
    if (payload.amount && payload.direction === 'debit') s.lineDebit = addDecimals(s.lineDebit, payload.amount);
    if (payload.amount && payload.direction === 'credit') s.lineCredit = addDecimals(s.lineCredit, payload.amount);
    out.set(account, s);
  }
  return [...out.values()];
}

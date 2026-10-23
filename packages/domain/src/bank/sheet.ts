// From a raw cell grid (spreadsheet.ts readGrid) to a statement table: the title rows above the
// header (bank, account, period, client), the header row — found by its words, and joined with a
// second header row under it when the bank splits "Корреспондент" or "Сумма" into sub-columns —
// and the body rows below it, each with its 1-based line in the file. Pure.
import { columnName, detectHeaderRow, unescapeCell } from '../sheet-shape.js';
import { readDate, datesIn, type DateOrder } from './dates.js';
import { readDecimal } from './decimal.js';
import { accountCurrency, readInn } from './identifiers.js';
import { CURRENCY_WORDS, headerScore, noiseKind, TITLE } from './vocabulary.js';

/** The header is looked for among this many non-empty rows (statements carry long title blocks). */
const HEADER_WINDOW = 40;
/** Rows past this are not read (sheet-shape's MAX_ROWS is the reader's own cap). */
export const MAX_STATEMENT_ROWS = 60_000;

export type BodyRow = { line: number; cells: string[] };

export type StatementSheet = {
  /** Column names, one per column of the widest row; empty headers get a placeholder. */
  headers: string[];
  /** The header row as written (the top row of a two-row header). */
  headerCells: string[];
  /** The second header row of a two-row header, as written; [] otherwise. */
  subHeaderCells: string[];
  /** 1-based line of the header row (of the top row when there are two). */
  headerRow: number;
  /** A second header row was joined into the names. */
  twoRowHeader: boolean;
  /** Rows above the header, as text. */
  titleRows: string[][];
  titleLines: string[];
  body: BodyRow[];
  /** Non-empty rows the reader did not keep, plus body rows past MAX_STATEMENT_ROWS. */
  extra: number;
};

const filled = (row: readonly string[]): number => row.reduce((n, c) => n + (c.trim() === '' ? 0 : 1), 0);
const lineText = (row: readonly string[]): string => row.map((c) => c.trim()).filter(Boolean).join(' · ');

/** A row that can only be a second header line: words, no dates, no numbers. */
function wordsOnly(row: readonly string[]): boolean {
  return row.every((c) => {
    const t = c.trim();
    return t === '' || (readDate(t).value === null && readDecimal(t).value === null);
  });
}

/** Names of a two-row header: a top label spanning empty (merged) cells prefixes the sub-labels under it. */
export function joinHeaderRows(top: readonly string[], sub: readonly string[]): string[] {
  const width = Math.max(top.length, sub.length);
  const out: string[] = [];
  let carry = '';
  for (let i = 0; i < width; i++) {
    const t = (top[i] ?? '').trim();
    const s = (sub[i] ?? '').trim();
    if (t) carry = t;
    if (t && s) out.push(`${t} ${s}`);
    else if (s) out.push(carry ? `${carry} ${s}` : s);
    else out.push(t);
  }
  return out;
}

/** Locates the statement table in a grid of trimmed cells (rows at their file line index). */
export function locateTable(grid: readonly (readonly string[] | undefined)[], extraRows = 0): StatementSheet {
  const rows: string[][] = [];
  const lines: number[] = [];
  grid.forEach((raw, i) => {
    const row = (raw ?? []).map((c) => unescapeCell((c ?? '').trim()));
    while (row.length > 0 && row[row.length - 1] === '') row.pop();
    if (filled(row) === 0) return;
    rows.push(row);
    lines.push(i + 1);
  });

  let headerIndex = -1;
  let best = 1;
  for (let i = 0; i < Math.min(HEADER_WINDOW, rows.length); i++) {
    const score = headerScore(rows[i] ?? []);
    if (score > best) { best = score; headerIndex = i; }
  }
  if (headerIndex < 0) headerIndex = rows.length > 0 ? detectHeaderRow(rows) : 0;

  const top = rows[headerIndex] ?? [];
  let names = [...top];
  let bodyStart = headerIndex + 1;
  let sub: string[] = [];
  const next = rows[headerIndex + 1];
  if (next && wordsOnly(next) && filled(next) >= 2) {
    const joined = joinHeaderRows(top, next);
    if (headerScore(joined) > headerScore(top)) { names = joined; sub = next; bodyStart++; }
  }

  const bodyRows = rows.slice(bodyStart);
  const kept = bodyRows.slice(0, MAX_STATEMENT_ROWS);
  const width = kept.reduce((w, r) => Math.max(w, r.length), names.length);
  const headers = Array.from({ length: width }, (_, i) => (names[i] ?? '').trim() || columnName(i));
  const titleRows = rows.slice(0, headerIndex);
  return {
    headers,
    headerCells: top,
    subHeaderCells: sub,
    headerRow: lines[headerIndex] ?? 1,
    twoRowHeader: bodyStart === headerIndex + 2,
    titleRows,
    titleLines: titleRows.map(lineText).slice(0, 20),
    body: kept.map((cells, i) => {
      const padded = [...cells];
      while (padded.length < width) padded.push('');
      return { line: lines[bodyStart + i] ?? 0, cells: padded };
    }),
    extra: extraRows + Math.max(0, bodyRows.length - kept.length),
  };
}

export type TitleInfo = {
  account: string | null;
  ownInn: string | null;
  ownName: string | null;
  bankName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  currency: string | null;
  /** Where the currency came from: a word in the titles, or the account's currency digits. */
  currencySource: 'title' | 'account' | null;
};

/** Text after the first ':' of a "Label: value" line, else the line. */
const valueOf = (text: string): string => {
  const at = text.indexOf(':');
  return (at >= 0 ? text.slice(at + 1) : text).trim();
};

/**
 * What the title rows say: the org's own account (20 digits, possibly spaced), its ИНН and name,
 * the bank, the period and the currency. Anything not written there stays null.
 */
export function readTitle(titleRows: readonly (readonly string[])[], order: DateOrder = 'dmy'): TitleInfo {
  const info: TitleInfo = { account: null, ownInn: null, ownName: null, bankName: null, periodFrom: null, periodTo: null, currency: null, currencySource: null };
  const texts = titleRows.map((r) => r.map((c) => c.trim()).filter(Boolean).join(' '));
  for (const text of texts) {
    const digitRuns = [...text.matchAll(/\d[\d \u00a0]{8,40}\d/g)].map((m) => m[0].replace(/[ \u00a0]/g, ''));
    if (!info.account && TITLE.account.test(text)) info.account = digitRuns.find((d) => d.length === 20) ?? null;
    if (!info.ownInn && TITLE.inn.test(text)) {
      const inn = digitRuns.map((d) => readInn(d).value).find((v) => v !== null);
      if (inn) info.ownInn = inn;
      else {
        const short = /(?:инн|stir|стир)[^\d]{0,10}(\d{9}|\d{14})(?!\d)/iu.exec(text);
        if (short?.[1]) info.ownInn = short[1];
      }
    }
    if (!info.ownName && TITLE.owner.test(text)) info.ownName = valueOf(text).slice(0, 300) || null;
    if (!info.bankName && TITLE.bank.test(text) && !TITLE.account.test(text) && !/выписк|ko.chirma/iu.test(text)) info.bankName = valueOf(text).slice(0, 120) || null;
    if (!info.periodFrom && TITLE.period.test(text)) {
      const dates = datesIn(text, order);
      if (dates.length >= 1) { info.periodFrom = dates[0] ?? null; info.periodTo = dates[1] ?? dates[0] ?? null; }
    }
    if (!info.currency && TITLE.currency.test(text)) {
      const word = CURRENCY_WORDS.find(([pattern]) => pattern.test(valueOf(text)));
      const code = word?.[1] ?? /\b([A-Z]{3})\b/.exec(valueOf(text))?.[1] ?? null;
      if (code) { info.currency = code; info.currencySource = 'title'; }
    }
  }
  // The account was found but no row named it: a lone 20-digit number in the titles is the account.
  if (!info.account) {
    for (const text of texts) {
      const run = [...text.matchAll(/\d[\d \u00a0]{18,40}\d/g)].map((m) => m[0].replace(/[ \u00a0]/g, '')).find((d) => d.length === 20);
      if (run) { info.account = run; break; }
    }
  }
  if (!info.currency) {
    const fromAccount = accountCurrency(info.account);
    if (fromAccount) { info.currency = fromAccount; info.currencySource = 'account'; }
  }
  return info;
}

/** The kind of a non-transaction row from its text, if it names one. */
export const rowNoise = (cells: readonly string[]): ReturnType<typeof noiseKind> => noiseKind(cells.filter(Boolean).join(' '));

/** "1 2 3 4 5 6" under the header: the column numbers many bank exports print. */
export function isColumnNumbers(cells: readonly string[]): boolean {
  const values = cells.map((c) => c.trim()).filter(Boolean);
  return values.length >= 3 && values.every((v, i) => v === String(i + 1));
}

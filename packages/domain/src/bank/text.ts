// Text statements from Uzbek internet banks: the encoding by content (UTF-8, windows-1251 or DOS
// cp866, bank research §7.2), the delimiter (';', tab, ',', and ASBT's '|' or '~' — its document
// export takes any character, research §2.3, samples/asbt/asbt31_internet_bank_73.txt) and, when
// there is none, the fixed-width layout ASBT writes when the delimiter is empty or a space ("длина
// каждого поля в строке в точности будет равна значению" — the same page). Pure.
import { decodeCyrillic, parseDelimited, sniffDelimiter, STATEMENT_DELIMITERS, type CyrillicEncoding, type StatementDelimiter } from '../spreadsheet-text.js';

export type StatementText = {
  grid: string[][];
  encoding: CyrillicEncoding;
  /** The delimiter used; null for a fixed-width file. */
  delimiter: StatementDelimiter | null;
  fixedWidth: boolean;
};

const DATE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/;
/** Fewest lines of one length that make a fixed-width table. */
const MIN_FIXED_LINES = 3;
const MIN_FIXED_WIDTH = 30;

/** Per-line count of `ch` outside quotes, for the lines given. */
const countOf = (line: string, ch: string): number => line.split(ch).length - 1;

/**
 * A fixed-width table: most lines share one length (≥ 30 characters) and no delimiter other than
 * ',' (a decimal comma in every amount would look consistent) splits those lines the same way.
 */
function fixedWidthLines(lines: readonly string[]): { width: number; rows: number[] } | null {
  const lengths = new Map<number, number[]>();
  lines.forEach((l, i) => {
    if (l.trim() === '') return;
    const list = lengths.get(l.length) ?? [];
    list.push(i);
    lengths.set(l.length, list);
  });
  let best: { width: number; rows: number[] } | null = null;
  for (const [width, rows] of lengths) if (!best || rows.length > best.rows.length) best = { width, rows };
  const filled = lines.filter((l) => l.trim() !== '').length;
  if (!best || best.width < MIN_FIXED_WIDTH || best.rows.length < MIN_FIXED_LINES || best.rows.length < filled * 0.6) return null;
  for (const d of STATEMENT_DELIMITERS) {
    if (d === ',') continue;
    const counts = best.rows.map((i) => countOf(lines[i] ?? '', d));
    if (counts.every((c) => c > 0 && c === counts[0])) return null;
  }
  return best;
}

/**
 * Splits fixed-width lines into columns. The data decides where values are: a run of text columns
 * ends where every data line is blank for two characters or more (one blank column inside a
 * purpose is a word gap, not a field end), or for one when the header starts a word right there.
 * The header decides where in that gap the cut falls (before its next word, so "Номер документа"
 * stays one name and a left-aligned "Сумма" over a right-aligned amount names the amount), and
 * splits fields that touch — a value filling its width, a 20-digit account next to an ИНН — where
 * one of its words starts after two spaces. Without a header only the data's gaps cut. `others` are cut at
 * the same places without deciding them (lines of another length).
 */
export function splitFixedWidth(lines: readonly string[], others: readonly string[] = []): string[][] {
  const width = lines.reduce((w, l) => Math.max(w, l.length), 0);
  const header = lines.find((l) => l.trim() !== '' && !DATE.test(l) && !/\d[.,]\d{2}\b/.test(l)) ?? null;
  const data = lines.filter((l) => l !== header && l.trim() !== '');
  const blank = Array.from({ length: width }, (_, p) => data.every((l) => (l[p] ?? ' ') === ' '));
  const h = (p: number): string => header?.[p] ?? ' ';
  const wordStart = (p: number): boolean => h(p) !== ' ' && h(p - 1) === ' ';
  const cuts = new Set<number>([0]);
  let end = -1;
  for (let p = 0; p < width; p++) {
    if (blank[p] || (p > 0 && !blank[p - 1])) continue;
    // p starts a run of data; end is where the previous run stopped.
    if (end >= 0 && (p - end >= 2 || (header !== null && wordStart(p)))) {
      let cut = p;
      if (header) for (let q = p; q > end; q--) if (wordStart(q)) { cut = q; break; }
      cuts.add(cut);
    }
    let e = p;
    while (e < width && !blank[e]) e++;
    end = e;
  }
  if (header) {
    for (const m of header.matchAll(/ {2,}(\S)/g)) {
      const at = (m.index ?? 0) + m[0].length - 1;
      if (!blank[at] && !blank[at - 1]) cuts.add(at);
    }
  }
  const starts = [...cuts].sort((x, y) => x - y);
  const spans = starts.map((x, i) => [x, starts[i + 1] ?? width] as const);
  return [...lines, ...others].map((l) => (l.trim() === '' ? [] : spans.map(([x, y]) => l.slice(x, y).trim())));
}

/** A payment line by its look: a date and an amount with two decimals. */
const PAYMENT = (line: string): boolean => DATE.test(line) && /\d[.,]\d{2}/.test(line);

/** The cell grid of a text statement. Title lines of a fixed-width file become one-cell rows. */
export function readStatementText(buffer: Uint8Array): StatementText {
  const { text, encoding } = decodeCyrillic(buffer);
  const lines = text.split(/\r?\n/);
  const fixed = fixedWidthLines(lines);
  if (fixed) {
    const rows = new Set(fixed.rows);
    // A payment line of another length inside the table (a writer that trims the last field) is a row of the same
    // table, cut at the same places; as a one-cell row it read as the previous line's purpose and its payment was lost.
    const first = Math.min(...fixed.rows);
    const stray = lines.flatMap((l, i) => (i > first && !rows.has(i) && l.trimEnd().length <= fixed.width && PAYMENT(l) ? [i] : []));
    const table = splitFixedWidth(fixed.rows.map((i) => lines[i] ?? ''), stray.map((i) => lines[i] ?? ''));
    const cells = new Map([...fixed.rows, ...stray].map((i, k) => [i, table[k] ?? []]));
    const grid = lines.map((l, i) => cells.get(i) ?? (l.trim() === '' ? [] : [l.trim()]));
    return { grid, encoding, delimiter: null, fixedWidth: true };
  }
  const delimiter = sniffDelimiter(text, 40, STATEMENT_DELIMITERS);
  return { grid: parseDelimited(text, delimiter), encoding, delimiter, fixedWidth: false };
}

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
 * Splits fixed-width lines into columns: a column boundary is where every data line has a space
 * before a character (a fully blank column of the text), plus where a header word starts after two
 * spaces (fields can touch when a value fills its width: a 20-digit account next to an МФО). A
 * column empty in every data line is joined to the next one (a left-aligned header over a
 * right-aligned amount).
 */
export function splitFixedWidth(lines: readonly string[]): string[][] {
  const width = lines.reduce((w, l) => Math.max(w, l.length), 0);
  const header = lines.find((l) => l.trim() !== '' && !DATE.test(l) && !/\d[.,]\d{2}\b/.test(l)) ?? null;
  const data = lines.filter((l) => l !== header && l.trim() !== '');
  const blank = Array.from({ length: width }, (_, p) => data.every((l) => (l[p] ?? ' ') === ' '));
  const cuts = new Set<number>([0]);
  for (let p = 1; p < width; p++) if (blank[p - 1] && !blank[p]) cuts.add(p);
  if (header) {
    for (const m of header.matchAll(/(?:^|\s{2,})(\S)/g)) {
      const at = (m.index ?? 0) + m[0].length - 1;
      if (at > 0 && !blank[at]) cuts.add(at);
    }
  }
  const starts = [...cuts].sort((a, b) => a - b);
  let spans = starts.map((s, i) => [s, starts[i + 1] ?? width] as [number, number]);
  const cell = (l: string, [a, b]: [number, number]): string => l.slice(a, b).trim();
  // A span blank in every data line: its header belongs to the next span.
  const merged: [number, number][] = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i] as [number, number];
    const empty = data.every((l) => cell(l, span) === '');
    const next = spans[i + 1];
    if (empty && next && header && cell(header, span) !== '') { spans[i + 1] = [span[0], next[1]]; continue; }
    if (empty && !(header && cell(header, span) !== '')) continue;
    merged.push(span);
  }
  spans = merged;
  return lines.map((l) => (l.trim() === '' ? [] : spans.map((s) => cell(l, s))));
}

/** The cell grid of a text statement. Title lines of a fixed-width file become one-cell rows. */
export function readStatementText(buffer: Uint8Array): StatementText {
  const { text, encoding } = decodeCyrillic(buffer);
  const lines = text.split(/\r?\n/);
  const fixed = fixedWidthLines(lines);
  if (fixed) {
    const rows = new Set(fixed.rows);
    const table = splitFixedWidth(fixed.rows.map((i) => lines[i] ?? ''));
    let k = 0;
    const grid = lines.map((l, i) => (rows.has(i) ? table[k++] ?? [] : l.trim() === '' ? [] : [l.trim()]));
    return { grid, encoding, delimiter: null, fixedWidth: true };
  }
  const delimiter = sniffDelimiter(text, 40, STATEMENT_DELIMITERS);
  return { grid: parseDelimited(text, delimiter), encoding, delimiter, fixedWidth: false };
}

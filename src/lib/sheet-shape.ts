// From a raw cell grid to headers and rows: drop empty rows, find the header
// row under any title rows, and keep every data cell. Pure, shared by the
// .xlsx and the text readers.

export const MAX_ROWS = 60_000;
/** The header row is looked for among this many non-empty rows. */
const HEADER_WINDOW = 10;
/** Rows used to learn the table's usual width. */
const WIDTH_SAMPLE = 60;

export type Shaped = {
  headers: string[];
  rows: string[][];
  /** Non-empty data rows in the file, including any past MAX_ROWS. */
  totalSeen: number;
  truncated: boolean;
  /** 1-based line (or sheet row) of the header in the file. */
  headerRow: number;
  /** Rows above the header (titles, notes) that were not read as data. */
  skippedAbove: number;
  emptyRowsSkipped: number;
};

const filled = (row: readonly string[]): number => row.reduce((n, c) => n + (c.trim() === '' ? 0 : 1), 0);

/** Drops empty cells at the end of a row, keeping empty cells between values. */
function trimEnd(row: readonly string[]): string[] {
  let end = row.length;
  while (end > 0 && (row[end - 1] ?? '').trim() === '') end--;
  return row.slice(0, end);
}

/**
 * Index of the header row: the first of the opening rows whose number of filled
 * cells is close to the table's usual width. A title or a note above the table
 * fills one or two cells and is skipped; a file without one starts at row 0.
 */
export function detectHeaderRow(rows: readonly (readonly string[])[]): number {
  const sample = rows.slice(0, WIDTH_SAMPLE).map(filled);
  if (sample.length === 0) return 0;
  const tally = new Map<number, number>();
  for (const n of sample) tally.set(n, (tally.get(n) ?? 0) + 1);
  let modal = 0;
  let hits = 0;
  for (const [width, count] of tally) {
    if (count > hits || (count === hits && width > modal)) { modal = width; hits = count; }
  }
  if (modal <= 1) return 0;
  const needed = Math.max(2, modal - Math.max(1, Math.floor(modal / 4)));
  const window = Math.min(HEADER_WINDOW, sample.length);
  for (let i = 0; i < window; i++) {
    if ((sample[i] ?? 0) >= needed) return i;
  }
  return 0;
}

/** Placeholder name for a column without a header. */
export const columnName = (index: number): string => `Ustun ${index + 1}`;

/** A leading apostrophe our exports add before = + - @ (formula guard) is not part of the value. */
export function unescapeCell(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/**
 * Shapes a grid of trimmed cells. `extraRows` counts non-empty rows the reader
 * saw but did not keep (past the limit).
 */
export function shapeGrid(grid: readonly (readonly string[] | undefined)[], extraRows = 0): Shaped {
  const nonEmpty: string[][] = [];
  const lines: number[] = [];
  let emptyRowsSkipped = 0;
  grid.forEach((raw, i) => {
    const row = trimEnd((raw ?? []).map((c) => unescapeCell(c.trim())));
    if (row.length === 0) { emptyRowsSkipped++; return; }
    nonEmpty.push(row);
    lines.push(i + 1);
  });
  const headerIndex = detectHeaderRow(nonEmpty);
  const headerCells = nonEmpty[headerIndex] ?? [];
  const data = nonEmpty.slice(headerIndex + 1);
  const kept = data.slice(0, MAX_ROWS);
  // A data row wider than the header still keeps every cell; the extra columns get placeholder names.
  const width = kept.reduce((w, r) => Math.max(w, r.length), headerCells.length);
  const headers = Array.from({ length: width }, (_, i) => {
    const h = headerCells[i] ?? '';
    return h === '' ? columnName(i) : h;
  });
  const rows = kept.map((r) => {
    const padded = [...r];
    while (padded.length < width) padded.push('');
    return padded;
  });
  const totalSeen = data.length + extraRows;
  return {
    headers, rows, totalSeen, truncated: totalSeen > rows.length,
    headerRow: lines[headerIndex] ?? 1, skippedAbove: headerIndex, emptyRowsSkipped,
  };
}

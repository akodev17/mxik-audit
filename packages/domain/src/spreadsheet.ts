// Reading uploaded files (catalogues, purchase lists, cheque and sales lists)
// and writing the corrected file back out. Server-only (exceljs). Deliberately
// separate from scripts/lib/xlsx.ts, which is a stripped-down streaming reader
// for the one 205 MB classifier layout.
import type ExcelJS from 'exceljs';
import { formulaSafe } from './csv-safe.js';
import { XLSX_HELD_BYTES, zipWithinLimits } from './security/zip-guard.js';
import { MAX_COLUMNS, MAX_ROWS, shapeGrid } from './sheet-shape.js';
import { decodeText, looksBinary, parseDelimited, sniffDelimiter, type Delimiter, type TextEncodingName } from './spreadsheet-text.js';
import { eachSheetRow, XlsxReadError } from './xlsx-stream.js';
import { streamedXlsx } from './xlsx-writer.js';

export { MAX_COLUMNS, MAX_ROWS } from './sheet-shape.js';

export type SheetData = {
  headers: string[];
  /** Every row as raw strings, aligned to `headers` by position. */
  rows: string[][];
};

export type FileKind = 'xlsx' | 'xls' | 'text';

/** What the reader saw, kept with the upload so the import can be explained later. */
export type ParseMeta = {
  format: 'xlsx' | 'csv';
  encoding: TextEncodingName | null;
  delimiter: Delimiter | null;
  headerRow: number;
  skippedAbove: number;
  emptyRowsSkipped: number;
  /** See Shaped.repeatedHeadersSkipped; absent on uploads read before it was counted. */
  repeatedHeadersSkipped?: number;
  totalSeen: number;
  truncated: boolean;
  /** See Shaped.lineJumps (sheet-shape.ts); absent on uploads read before it was kept. */
  lineJumps?: [number, number][] | null;
  /** Cells holding a value right of MAX_COLUMNS, not read (.xlsx only); absent when there were none. */
  cellsPastColumnLimit?: number;
};

export type ParseResult = SheetData & { truncated: boolean; totalSeen: number; meta: ParseMeta };

/** Stable reasons a file cannot be read; the action turns them into the user's language. */
export type ParseErrorCode = 'legacy_xls' | 'zip_limits' | 'unreadable' | 'no_sheet' | 'binary' | 'not_xlsx';

export class ParseError extends Error {
  constructor(readonly code: ParseErrorCode) {
    super(code);
    this.name = 'ParseError';
  }
}

export const parseErrorCode = (error: unknown): ParseErrorCode => (error instanceof ParseError ? error.code : 'unreadable');

const ZIP = [0x50, 0x4b];
const OLE = [0xd0, 0xcf, 0x11, 0xe0];
const starts = (buffer: Uint8Array, magic: readonly number[]): boolean => magic.every((b, i) => buffer[i] === b);

/** By content, not by name: PK is an .xlsx (zip), D0 CF 11 E0 a legacy .xls, anything else is read as text. */
export function sniffKind(buffer: Uint8Array): FileKind {
  if (starts(buffer, ZIP)) return 'xlsx';
  if (starts(buffer, OLE)) return 'xls';
  return 'text';
}

/** Whole numbers without an exponent; a 1–3 digit number with exactly three decimals gets a fourth, so it never reads as thousands. */
export function numberText(value: number): string {
  if (Number.isInteger(value)) return Math.abs(value) >= 1e15 ? value.toFixed(0) : String(value);
  const text = String(value);
  return /^-?[1-9]\d{0,2}\.\d{3}$/.test(text) ? `${text}0` : text;
}

/** Cell to string, without ExcelJS's object wrappers leaking through (exported for the reader-equality test). */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('error' in value) return '';
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('').trim();
    }
  }
  // Anything else (an unexpected object shape) is not usable cell text; an
  // "[object Object]" in a catalogue row would be worse than an empty cell.
  return '';
}

/** Rows the reader keeps before counting the rest: room for title rows above the header. */
const KEEP = MAX_ROWS + 20;

async function readXlsx(buffer: Buffer): Promise<{ grid: (string[] | undefined)[]; extra: number; cellsPastColumnLimit: number }> {
  // An .xlsx is a zip: refuse one that would inflate past the limits before anything parses it.
  if (!(await zipWithinLimits(buffer))) throw new ParseError('zip_limits');
  // Rows sit at their sheet row number, so the header can be named by the row the user sees.
  const grid: (string[] | undefined)[] = [];
  let kept = 0;
  let extra = 0;
  try {
    // The sheet streams (xlsx-stream.ts): rows past KEEP are counted, not kept, so the truncation notice still quotes the file's total.
    const { cellsPastColumnLimit } = await eachSheetRow(buffer, (rowNumber, values) => {
      // A merged title repeats its text in every merged cell; the reader left only the first one.
      const cells = Array.from(values, (v) => (v === undefined ? '' : cellText(v as ExcelJS.CellValue)));
      if (!cells.some((v) => v !== '')) return;
      if (kept < KEEP) { grid[rowNumber - 1] = cells; kept++; } else extra++;
    }, { maxColumns: MAX_COLUMNS, maxHeldBytes: XLSX_HELD_BYTES });
    return { grid, extra, cellsPastColumnLimit };
  } catch (error) {
    if (!(error instanceof XlsxReadError)) throw new ParseError('unreadable');
    throw new ParseError(error.code === 'held_limit' ? 'zip_limits' : error.code);
  }
}

function readText(buffer: Buffer): { grid: string[][]; encoding: TextEncodingName; delimiter: Delimiter } {
  if (looksBinary(buffer)) throw new ParseError('binary');
  const { text, encoding } = decodeText(buffer);
  const delimiter = sniffDelimiter(text);
  return { grid: parseDelimited(text, delimiter), encoding, delimiter };
}

export type RawGrid = {
  kind: 'xlsx' | 'text';
  /** Rows at their sheet row (file line) index; undefined = an empty row. */
  grid: (string[] | undefined)[];
  /** Non-empty rows past the reader's limit, counted and not kept. */
  extra: number;
  /** Cells holding a value right of MAX_COLUMNS, not read (.xlsx; 0 for text). */
  cellsPastColumnLimit: number;
  encoding: TextEncodingName | null;
  delimiter: Delimiter | null;
};

/**
 * The cell grid of an upload by its content, before any header detection: for readers that need
 * the rows above the header too (a bank statement's title rows carry its account and period).
 * Throws ParseError with a stable code.
 */
export async function readGrid(buffer: Buffer): Promise<RawGrid> {
  const kind = sniffKind(buffer);
  if (kind === 'xls') throw new ParseError('legacy_xls');
  if (kind === 'xlsx') return { kind, ...(await readXlsx(buffer)), encoding: null, delimiter: null };
  return { kind, extra: 0, cellsPastColumnLimit: 0, ...readText(buffer) };
}

/**
 * Parses an upload by its content: .xlsx (after the zip-bomb check) or text
 * (UTF-8 or windows-1251, ';' ',' or tab). Title rows above the header are
 * skipped, every data cell is kept, and rows past MAX_ROWS are counted, not read.
 * Throws ParseError with a stable code.
 */
export async function parseUpload(buffer: Buffer, filename?: string): Promise<ParseResult> {
  const { kind, grid, extra, cellsPastColumnLimit, encoding, delimiter } = await readGrid(buffer);
  const shaped = shapeGrid(grid, extra);
  // Named .xlsx but not a zip, and no table in it as text either (no rows, not even two columns): a damaged
  // or renamed file, not an empty one (B11). A header-only CSV renamed to .xlsx is still "no rows".
  if (kind === 'text' && shaped.rows.length === 0 && shaped.headers.length < 2 && /\.xlsx$/i.test(filename ?? '')) throw new ParseError('not_xlsx');
  const meta: ParseMeta = {
    format: kind === 'xlsx' ? 'xlsx' : 'csv', encoding, delimiter,
    headerRow: shaped.headerRow, skippedAbove: shaped.skippedAbove, emptyRowsSkipped: shaped.emptyRowsSkipped,
    repeatedHeadersSkipped: shaped.repeatedHeadersSkipped,
    totalSeen: shaped.totalSeen, truncated: shaped.truncated, lineJumps: shaped.lineJumps,
    ...(cellsPastColumnLimit > 0 ? { cellsPastColumnLimit } : {}),
  };
  return { headers: shaped.headers, rows: shaped.rows, truncated: shaped.truncated, totalSeen: shaped.totalSeen, meta };
}

export type ExportRow = {
  /** Original cells, in the original column order. */
  original: string[];
  mxik: string;
  unit: string;
  packaging: string;
  auditStatus: string;
  /** When EHF stops accepting the exported code (restricted_code), as text; empty when it is not restricted. */
  restricted?: string;
};

export type ExportOptions = {
  headers: string[];
  rows: readonly ExportRow[];
  /** Column indexes the mapping designated, so they can be overwritten in place. */
  mxikColumn: number | null;
  unitColumn: number | null;
  labels: {
    mxik: string;
    unit: string;
    packaging: string;
    auditStatus: string;
    restricted: string;
  };
  sheetName?: string;
};

/** A list, or rows fed batch by batch (the catalogue export) so they are never all in memory. */
export type ExportRows = Iterable<ExportRow> | AsyncIterable<ExportRow>;

/**
 * Rebuilds the uploaded file with accepted decisions applied.
 *
 * The original column order is preserved. If the upload already had an MXIK or
 * unit column, it is overwritten in place so the file still opens the way the
 * accountant expects; otherwise a column is appended. The status column is always
 * appended, so nothing is silently changed without a trace. Every cell is
 * written as text and guarded against formula injection.
 *
 * Written with ExcelJS's streaming writer: each row is serialised and dropped as
 * soon as it is added, so a 60,000-row export never holds the workbook's cell
 * objects; only the zipped bytes are collected. The cells, styles, column widths,
 * frozen header and sheet name are those the in-memory builder wrote (spreadsheet
 * export test compares the two).
 */
export async function buildExport(options: Omit<ExportOptions, 'rows'> & { rows: ExportRows }): Promise<Buffer> {
  const { headers, rows, mxikColumn, unitColumn, labels } = options;

  const outHeaders = [...headers];
  const mxikIndex = mxikColumn ?? (outHeaders.push(labels.mxik) - 1);
  const unitIndex = unitColumn ?? (outHeaders.push(labels.unit) - 1);
  const packagingIndex = outHeaders.push(labels.packaging) - 1;
  const statusIndex = outHeaders.push(labels.auditStatus) - 1;
  const restrictedIndex = outHeaders.push(labels.restricted) - 1;

  return streamedXlsx(async (workbook) => {
    const sheet = workbook.addWorksheet(options.sheetName ?? 'Katalog', { views: [{ state: 'frozen', ySplit: 1 }] });

    // Columns first: the streaming writer puts <cols> ahead of the first row, and new cells take the column's style.
    // MXIK codes are 17 digits: force text so Excel does not render 1.7E+16.
    sheet.getColumn(mxikIndex + 1).numFmt = '@';
    sheet.getColumn(mxikIndex + 1).width = 20;
    sheet.getColumn(statusIndex + 1).width = 24;
    sheet.getColumn(restrictedIndex + 1).width = 26;

    const header = sheet.addRow(outHeaders.map(formulaSafe));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    });
    header.commit();

    for await (const row of rows) {
      const cells = [...row.original];
      while (cells.length < outHeaders.length) cells.push('');
      cells[mxikIndex] = row.mxik;
      cells[unitIndex] = row.unit;
      cells[packagingIndex] = row.packaging;
      cells[statusIndex] = row.auditStatus;
      cells[restrictedIndex] = row.restricted ?? '';
      sheet.addRow(cells.map(formulaSafe)).commit();
    }

    sheet.commit();
  });
}

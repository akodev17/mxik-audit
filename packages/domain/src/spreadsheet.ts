// Reading uploaded files (catalogues, purchase lists, cheque and sales lists)
// and writing the corrected file back out. Server-only (exceljs). Deliberately
// separate from scripts/lib/xlsx.ts, which is a stripped-down streaming reader
// for the one 205 MB classifier layout.
import ExcelJS from 'exceljs';
import { formulaSafe } from './csv-safe.js';
import { zipWithinLimits } from './security/zip-guard.js';
import { MAX_ROWS, shapeGrid } from './sheet-shape.js';
import { decodeText, looksBinary, parseDelimited, sniffDelimiter, type Delimiter, type TextEncodingName } from './spreadsheet-text.js';

export { MAX_ROWS } from './sheet-shape.js';

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

/** Cell to string, without ExcelJS's object wrappers leaking through. */
function cellText(value: ExcelJS.CellValue): string {
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

async function readXlsx(buffer: Buffer): Promise<{ grid: (string[] | undefined)[]; extra: number }> {
  // An .xlsx is a zip: refuse one that would inflate past the limits before ExcelJS opens it.
  if (!(await zipWithinLimits(buffer))) throw new ParseError('zip_limits');
  const workbook = new ExcelJS.Workbook();
  try {
    // exceljs declares its own Buffer type, which drifts from @types/node's
    // generic Buffer<ArrayBufferLike>. Same bytes either way.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new ParseError('unreadable');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ParseError('no_sheet');

  // Rows sit at their sheet row number, so the header can be named by the row the user sees.
  const grid: (string[] | undefined)[] = [];
  let kept = 0;
  let extra = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    row.eachCell((cell, col) => {
      // A merged title repeats its text in every merged cell; only the first one holds it.
      if (cell.type === ExcelJS.ValueType.Merge) return;
      values[col - 1] = cellText(cell.value);
    });
    const cells = Array.from(values, (v) => v ?? '');
    if (!cells.some((v) => v !== '')) return;
    if (kept < KEEP) { grid[row.number - 1] = cells; kept++; } else extra++;
  });
  return { grid, extra };
}

function readText(buffer: Buffer): { grid: string[][]; encoding: TextEncodingName; delimiter: Delimiter } {
  if (looksBinary(buffer)) throw new ParseError('binary');
  const { text, encoding } = decodeText(buffer);
  const delimiter = sniffDelimiter(text);
  return { grid: parseDelimited(text, delimiter), encoding, delimiter };
}

/**
 * Parses an upload by its content: .xlsx (after the zip-bomb check) or text
 * (UTF-8 or windows-1251, ';' ',' or tab). Title rows above the header are
 * skipped, every data cell is kept, and rows past MAX_ROWS are counted, not read.
 * Throws ParseError with a stable code.
 */
export async function parseUpload(buffer: Buffer, filename?: string): Promise<ParseResult> {
  const kind = sniffKind(buffer);
  if (kind === 'xls') throw new ParseError('legacy_xls');

  let grid: (string[] | undefined)[];
  let extra = 0;
  let encoding: TextEncodingName | null = null;
  let delimiter: Delimiter | null = null;
  if (kind === 'xlsx') {
    ({ grid, extra } = await readXlsx(buffer));
  } else {
    ({ grid, encoding, delimiter } = readText(buffer));
  }

  const shaped = shapeGrid(grid, extra);
  // Named .xlsx but not a zip, and no table in it as text either (no rows, not even two columns): a damaged
  // or renamed file, not an empty one (B11). A header-only CSV renamed to .xlsx is still "no rows".
  if (kind === 'text' && shaped.rows.length === 0 && shaped.headers.length < 2 && /\.xlsx$/i.test(filename ?? '')) throw new ParseError('not_xlsx');
  const meta: ParseMeta = {
    format: kind === 'xlsx' ? 'xlsx' : 'csv', encoding, delimiter,
    headerRow: shaped.headerRow, skippedAbove: shaped.skippedAbove, emptyRowsSkipped: shaped.emptyRowsSkipped,
    repeatedHeadersSkipped: shaped.repeatedHeadersSkipped,
    totalSeen: shaped.totalSeen, truncated: shaped.truncated, lineJumps: shaped.lineJumps,
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

/**
 * Rebuilds the uploaded file with accepted decisions applied.
 *
 * The original column order is preserved. If the upload already had an MXIK or
 * unit column, it is overwritten in place so the file still opens the way the
 * accountant expects; otherwise a column is appended. The status column is always
 * appended, so nothing is silently changed without a trace. Every cell is
 * written as text and guarded against formula injection.
 */
export async function buildExport(options: ExportOptions): Promise<Buffer> {
  const { headers, rows, mxikColumn, unitColumn, labels } = options;

  const outHeaders = [...headers];
  const mxikIndex = mxikColumn ?? (outHeaders.push(labels.mxik) - 1);
  const unitIndex = unitColumn ?? (outHeaders.push(labels.unit) - 1);
  const packagingIndex = outHeaders.push(labels.packaging) - 1;
  const statusIndex = outHeaders.push(labels.auditStatus) - 1;
  const restrictedIndex = outHeaders.push(labels.restricted) - 1;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tasnivo';
  const sheet = workbook.addWorksheet(options.sheetName ?? 'Katalog');

  sheet.addRow(outHeaders.map(formulaSafe));
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });

  for (const row of rows) {
    const cells = [...row.original];
    while (cells.length < outHeaders.length) cells.push('');
    cells[mxikIndex] = row.mxik;
    cells[unitIndex] = row.unit;
    cells[packagingIndex] = row.packaging;
    cells[statusIndex] = row.auditStatus;
    cells[restrictedIndex] = row.restricted ?? '';
    sheet.addRow(cells.map(formulaSafe));
  }

  // MXIK codes are 17 digits: force text so Excel does not render 1.7E+16.
  sheet.getColumn(mxikIndex + 1).numFmt = '@';
  sheet.getColumn(mxikIndex + 1).width = 20;
  sheet.getColumn(statusIndex + 1).width = 24;
  sheet.getColumn(restrictedIndex + 1).width = 26;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

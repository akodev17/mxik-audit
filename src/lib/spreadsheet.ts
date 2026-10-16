// Reading uploaded catalogues and writing the corrected file back out.
// Server-only (exceljs). Deliberately separate from scripts/lib/xlsx.ts, which
// is a stripped-down streaming reader for the one 205 MB classifier layout.
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

export type SheetData = {
  headers: string[];
  /** Every row as raw strings, aligned to `headers` by position. */
  rows: string[][];
};

/** Cell to string, without ExcelJS's object wrappers leaking through. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return cellText(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text).join('').trim();
    }
    if ('hyperlink' in value && 'text' in value && typeof value.text === 'string') {
      return value.text.trim();
    }
  }
  // Anything else (an unexpected object shape) is not usable cell text; an
  // "[object Object]" in a catalogue row would be worse than an empty cell.
  return '';
}

const MAX_ROWS = 60_000;

export type ParseResult = SheetData & { truncated: boolean };

/** Parses .xlsx or .csv. The first non-empty row is treated as the header. */
export async function parseUpload(buffer: Buffer, filename: string): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(filename);

  if (isCsv) {
    // Static import: under Next's bundler a dynamic import('node:stream') has no Readable.
    // Keep every cell as written: the default mapper turns 17-digit codes into
    // floats, dropping the leading zero and digits beyond 2^53.
    await workbook.csv.read(Readable.from(buffer.toString('utf8')), { map: (value: unknown) => value });
  } else {
    // exceljs declares its own Buffer type, which drifts from @types/node's
    // generic Buffer<ArrayBufferLike>. Same bytes either way.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Faylda birorta ham varaq topilmadi.');

  const collected: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    if (collected.length > MAX_ROWS) return;
    const values: string[] = [];
    // ExcelJS row.values is 1-based with a leading hole.
    const raw = row.values;
    if (Array.isArray(raw)) {
      for (let i = 1; i < raw.length; i++) values.push(cellText(raw[i]));
    }
    if (values.some((v) => v !== '')) collected.push(values);
  });

  const headerRow = collected.shift() ?? [];
  const headers = headerRow.map((h, i) => (h === '' ? `Ustun ${i + 1}` : h));
  const width = headers.length;
  const rows = collected.map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded;
  });

  return { headers, rows, truncated: collected.length > MAX_ROWS };
}

export type ExportRow = {
  /** Original cells, in the original column order. */
  original: string[];
  mxik: string;
  unit: string;
  packaging: string;
  auditStatus: string;
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
  };
};

/**
 * Rebuilds the uploaded file with accepted decisions applied.
 *
 * The original column order is preserved. If the upload already had an MXIK or
 * unit column, it is overwritten in place so the file still opens the way the
 * accountant expects; otherwise a column is appended. `audit_status` is always
 * appended, so nothing is silently changed without a trace.
 */
export async function buildExport(options: ExportOptions): Promise<Buffer> {
  const { headers, rows, mxikColumn, unitColumn, labels } = options;

  const outHeaders = [...headers];
  const appended: { key: 'mxik' | 'unit' | 'packaging' | 'auditStatus'; index: number }[] = [];

  const mxikIndex = mxikColumn ?? (outHeaders.push(labels.mxik) - 1);
  if (mxikColumn === null) appended.push({ key: 'mxik', index: mxikIndex });
  const unitIndex = unitColumn ?? (outHeaders.push(labels.unit) - 1);
  if (unitColumn === null) appended.push({ key: 'unit', index: unitIndex });
  const packagingIndex = outHeaders.push(labels.packaging) - 1;
  appended.push({ key: 'packaging', index: packagingIndex });
  const statusIndex = outHeaders.push(labels.auditStatus) - 1;
  appended.push({ key: 'auditStatus', index: statusIndex });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MXIK Audit';
  const sheet = workbook.addWorksheet('Katalog');

  sheet.addRow(outHeaders);
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
    sheet.addRow(cells);
  }

  // MXIK codes are 17 digits: force text so Excel does not render 1.7E+16.
  sheet.getColumn(mxikIndex + 1).numFmt = '@';
  sheet.getColumn(mxikIndex + 1).width = 20;
  sheet.getColumn(statusIndex + 1).width = 20;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

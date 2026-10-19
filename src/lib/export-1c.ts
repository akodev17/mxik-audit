// "1C uchun": one row per product with the code and unit to load into 1C
// through its standard "load from a spreadsheet" processing, where the user
// maps the columns. Two forms: a semicolon-separated UTF-8 CSV with a BOM, as
// 1C and Excel in a Russian locale expect (for 1C only: Excel would turn the
// codes into numbers), and an .xlsx whose code and barcode columns are text.
import ExcelJS from 'exceljs';
import { formulaSafe } from './csv-safe.js';

export type OneCRow = {
  name: string;
  mxik: string;
  unit: string;
  barcode: string;
  auditStatus: string;
};

/** Column titles in the requester's language: name, code, unit, barcode, status. */
export type OneCHeaders = readonly [string, string, string, string, string];

export const ONE_C_HEADERS_RU: OneCHeaders = ['Наименование', 'ИКПУ', 'Единица измерения', 'Штрихкод', 'Статус аудита'];

const BOM = String.fromCharCode(0xfeff);
const EOL = '\r\n';

function field(value: string): string {
  const safe = formulaSafe(value);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const cellsOf = (r: OneCRow): string[] => [r.name, r.mxik, r.unit, r.barcode, r.auditStatus];

export function build1cCsv(rows: readonly OneCRow[], headers: OneCHeaders = ONE_C_HEADERS_RU): Buffer {
  const lines = [[...headers], ...rows.map(cellsOf)].map((cells) => cells.map(field).join(';'));
  // The byte-order mark makes Excel and 1C read the file as UTF-8.
  return Buffer.from(BOM + lines.join(EOL) + EOL, 'utf8');
}

/** The same rows as an .xlsx; code and barcode columns are text so leading zeros and all 17 digits survive. */
export async function build1cXlsx(rows: readonly OneCRow[], headers: OneCHeaders = ONE_C_HEADERS_RU): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MXIK Audit';
  const sheet = workbook.addWorksheet('1C');
  sheet.columns = [
    { width: 48 }, { width: 22, style: { numFmt: '@' } }, { width: 18 }, { width: 18, style: { numFmt: '@' } }, { width: 26 },
  ];
  sheet.addRow([...headers].map(formulaSafe)).font = { bold: true };
  for (const row of rows) sheet.addRow(cellsOf(row).map(formulaSafe));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

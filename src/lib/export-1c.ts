// "1C uchun CSV": one row per product with the code and unit to load into 1C
// through its standard "load from a spreadsheet" processing, where the user
// maps the columns. Semicolon-separated UTF-8 with a BOM, as 1C and Excel in
// Russian locale expect. Pure.

export type OneCRow = {
  name: string;
  mxik: string;
  unit: string;
  barcode: string;
  auditStatus: string;
};

const HEADERS = ['Наименование', 'ИКПУ', 'Единица измерения', 'Штрихкод', 'Статус аудита'];
const BOM = String.fromCharCode(0xfeff);
const EOL = '\r\n';

function field(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function build1cCsv(rows: readonly OneCRow[]): Buffer {
  const lines = [HEADERS, ...rows.map((r) => [r.name, r.mxik, r.unit, r.barcode, r.auditStatus])]
    .map((cells) => cells.map(field).join(';'));
  // The byte-order mark makes Excel and 1C read the file as UTF-8.
  return Buffer.from(BOM + lines.join(EOL) + EOL, 'utf8');
}

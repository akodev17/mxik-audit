// "1C uchun": one row per product with the code and unit to load into 1C through its standard
// "load from a spreadsheet" processing, where the user maps the columns. Two forms: a
// semicolon-separated UTF-8 CSV with a BOM, as 1C and Excel in a Russian locale expect (for 1C
// only: Excel would turn the codes into numbers), and an .xlsx whose code and barcode columns are
// text. The builders live with every other 1C file in onec/sheets.ts (one place for 1C formats);
// this module keeps the catalogue export's imports working.
export { build1cCsv, build1cXlsx, ONE_C_HEADERS_RU, type OneCHeaders, type OneCRow } from './onec/sheets.js';

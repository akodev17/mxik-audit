// Every spreadsheet Tasnivo writes for 1C, in one place (docs/TASNIVO_AI_PLAN_2026-10-23.md §4.3:
// no second 1C file builder elsewhere):
// - the catalogue audit's "1C file" (CSV and .xlsx for 1C's generic «Загрузка из табличного
//   документа»; export-1c.ts re-exports these two so the catalogue download is unchanged);
// - `nomenclature_xlsx`: products for «Номенклатура → Загрузить из файла», with the attributes the
//   Uzbek edition verifiably names (1c.uz letter №32589: «Код из классификатора» from the
//   «Классификатор ИКПУ», «Код упаковки»);
// - `receipt_xlsx`: one sheet per incoming invoice (header block, then the lines) for
//   «Поступление товаров и услуг»;
// - `counterparties_xlsx`: the columns a 1C «Контрагенты» list exports (and import reads back).
// Codes, ИНН, accounts and barcodes are text cells so leading zeros and all digits survive.
// Server-only (exceljs).
import ExcelJS from 'exceljs';
import { formulaSafe } from '../csv-safe.js';
import { ruDate } from './bank-exchange.js';

// ── The catalogue audit's 1C file (moved from export-1c.ts) ───────────────────────────────

export type OneCRow = {
  name: string;
  mxik: string;
  unit: string;
  barcode: string;
  auditStatus: string;
  /** When EHF stops accepting the code, as text; empty when it is not restricted. */
  restricted?: string;
};

/** Column titles in the requester's language: name, code, unit, barcode, status, EHF restriction. */
export type OneCHeaders = readonly [string, string, string, string, string, string];

export const ONE_C_HEADERS_RU: OneCHeaders = ['Наименование', 'ИКПУ', 'Единица измерения', 'Штрихкод', 'Статус аудита', 'Ограничение в ЭСФ'];

const BOM = String.fromCharCode(0xfeff);
const EOL = '\r\n';

function field(value: string): string {
  const safe = formulaSafe(value);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const cellsOf = (r: OneCRow): string[] => [r.name, r.mxik, r.unit, r.barcode, r.auditStatus, r.restricted ?? ''];

export function build1cCsv(rows: readonly OneCRow[], headers: OneCHeaders = ONE_C_HEADERS_RU): Buffer {
  const lines = [[...headers], ...rows.map(cellsOf)].map((cells) => cells.map(field).join(';'));
  // The byte-order mark makes Excel and 1C read the file as UTF-8.
  return Buffer.from(BOM + lines.join(EOL) + EOL, 'utf8');
}

/** The same rows as an .xlsx; code and barcode columns are text so leading zeros and all 17 digits survive. */
export async function build1cXlsx(rows: readonly OneCRow[], headers: OneCHeaders = ONE_C_HEADERS_RU): Promise<Buffer> {
  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet('1C');
  sheet.columns = [
    { width: 48 }, { width: 22, style: { numFmt: '@' } }, { width: 18 }, { width: 18, style: { numFmt: '@' } }, { width: 26 }, { width: 26 },
  ];
  sheet.addRow([...headers].map(formulaSafe)).font = { bold: true };
  for (const row of rows) sheet.addRow(cellsOf(row).map(formulaSafe));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ── Shared helpers ─────────────────────────────────────────────────────────────────────────

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A fixed creation date keeps the bytes of the same input identical (golden files, idempotent repeats). */
function newWorkbook(created?: Date): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tasnivo';
  if (created) {
    workbook.created = created;
    workbook.modified = created;
  }
  return workbook;
}

const text = (value: string | null | undefined): string => formulaSafe(value ?? '');
/** Decimal string → number cell (Excel shows it as a number; 1C reads it as one). Empty stays empty. */
const num = (value: string | null | undefined): number | string => (value === null || value === undefined || value === '' ? '' : Number(value));

type Column = { header: string; width: number; kind: 'text' | 'code' | 'number' };

function table(sheet: ExcelJS.Worksheet, columns: readonly Column[], rows: readonly (string | number)[][], startRow = 1): void {
  columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    col.width = Math.max(col.width ?? 0, c.width);
  });
  const head = sheet.getRow(startRow);
  columns.forEach((c, i) => { head.getCell(i + 1).value = c.header; });
  head.font = { bold: true };
  rows.forEach((cells, r) => {
    const row = sheet.getRow(startRow + 1 + r);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const value = cells[i] ?? '';
      cell.value = c.kind === 'number' ? value : typeof value === 'string' ? formulaSafe(value) : String(value);
      if (c.kind === 'code') cell.numFmt = '@';
      if (c.kind === 'number' && typeof value === 'number') cell.numFmt = '#,##0.00####';
    });
  });
}

// ── nomenclature_xlsx ──────────────────────────────────────────────────────────────────────

export type NomenclatureRow = {
  name: string;
  mxik: string | null;
  packageCode: string | null;
  unit: string | null;
  barcode: string | null;
  article: string | null;
};

/** The products sheet's titles: the Uzbek edition's attribute names (Russian interface). */
export const NOMENCLATURE_HEADERS = ['Наименование', 'Код из классификатора', 'Код упаковки', 'Единица измерения', 'Штрихкод', 'Артикул'] as const;

/** One row per distinct product (same name, code and package once). */
export function distinctProducts(rows: readonly NomenclatureRow[]): NomenclatureRow[] {
  const seen = new Set<string>();
  const out: NomenclatureRow[] = [];
  for (const r of rows) {
    const key = [r.name.trim().toLowerCase(), r.mxik ?? '', r.packageCode ?? '', r.barcode ?? ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export async function buildNomenclatureXlsx(rows: readonly NomenclatureRow[], created?: Date): Promise<Buffer> {
  const workbook = newWorkbook(created);
  const sheet = workbook.addWorksheet('Номенклатура');
  const [name, code, pack, unit, barcode, article] = NOMENCLATURE_HEADERS;
  table(sheet, [
    { header: name, width: 50, kind: 'text' }, { header: code, width: 22, kind: 'code' }, { header: pack, width: 16, kind: 'code' },
    { header: unit, width: 18, kind: 'text' }, { header: barcode, width: 18, kind: 'code' }, { header: article, width: 16, kind: 'code' },
  ], distinctProducts(rows).map((r) => [text(r.name), r.mxik ?? '', r.packageCode ?? '', text(r.unit), r.barcode ?? '', text(r.article)]));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ── receipt_xlsx ───────────────────────────────────────────────────────────────────────────

export type ReceiptParty = { name: string; inn: string | null };

export type ReceiptLine = {
  lineNo: number;
  name: string;
  mxik: string | null;
  packageCode: string | null;
  unit: string | null;
  quantity: string;
  price: string;
  amount: string;
  vatRate: string | null;
  vatAmount: string | null;
  total: string | null;
};

export type ReceiptInvoice = {
  number: string;
  /** YYYY-MM-DD. */
  date: string;
  contractNumber: string | null;
  contractDate: string | null;
  seller: ReceiptParty;
  buyer: ReceiptParty;
  currency: string;
  lines: readonly ReceiptLine[];
  totals: { amount: string; vat: string | null; total: string };
};

export const RECEIPT_LINE_HEADERS = ['№', 'Наименование', 'ИКПУ', 'Код упаковки', 'Ед.', 'Количество', 'Цена', 'Сумма', 'Ставка НДС', 'Сумма НДС', 'Всего'] as const;
export const RECEIPT_HEADER_LABELS = {
  seller: 'Поставщик', sellerInn: 'ИНН поставщика', buyer: 'Покупатель', buyerInn: 'ИНН покупателя',
  number: 'Номер счета-фактуры', date: 'Дата', contract: 'Договор', currency: 'Валюта', total: 'Итого',
} as const;

/** Sheet names: at most 31 characters, none of []:*?/\ and unique within the workbook. */
function sheetName(base: string, taken: Set<string>): string {
  const clean = base.replace(/[[\]:*?/\\]/g, '-').slice(0, 28) || 'Счет-фактура';
  let name = clean;
  for (let i = 2; taken.has(name); i++) name = `${clean.slice(0, 26)} ${i}`;
  taken.add(name);
  return name;
}

export async function buildReceiptXlsx(invoices: readonly ReceiptInvoice[], created?: Date): Promise<Buffer> {
  const workbook = newWorkbook(created);
  const taken = new Set<string>();
  const L = RECEIPT_HEADER_LABELS;
  for (const inv of invoices) {
    const sheet = workbook.addWorksheet(sheetName(`${inv.number} ${ruDate(inv.date)}`, taken));
    const contract = inv.contractNumber ? `${inv.contractNumber}${inv.contractDate ? ` от ${ruDate(inv.contractDate)}` : ''}` : '';
    const header: [string, string][] = [
      [L.seller, inv.seller.name], [L.sellerInn, inv.seller.inn ?? ''], [L.buyer, inv.buyer.name], [L.buyerInn, inv.buyer.inn ?? ''],
      [L.number, inv.number], [L.date, ruDate(inv.date)], [L.contract, contract], [L.currency, inv.currency],
    ];
    header.forEach(([label, value], i) => {
      const row = sheet.getRow(i + 1);
      row.getCell(1).value = label;
      row.getCell(1).font = { bold: true };
      row.getCell(2).value = formulaSafe(value);
      row.getCell(2).numFmt = '@';
    });
    const start = header.length + 2;
    const H = RECEIPT_LINE_HEADERS;
    table(sheet, [
      { header: H[0], width: 6, kind: 'number' }, { header: H[1], width: 50, kind: 'text' }, { header: H[2], width: 22, kind: 'code' },
      { header: H[3], width: 14, kind: 'code' }, { header: H[4], width: 10, kind: 'text' }, { header: H[5], width: 12, kind: 'number' },
      { header: H[6], width: 14, kind: 'number' }, { header: H[7], width: 16, kind: 'number' }, { header: H[8], width: 10, kind: 'number' },
      { header: H[9], width: 14, kind: 'number' }, { header: H[10], width: 16, kind: 'number' },
    ], inv.lines.map((l) => [
      l.lineNo, text(l.name), l.mxik ?? '', l.packageCode ?? '', text(l.unit), num(l.quantity), num(l.price), num(l.amount),
      num(l.vatRate), num(l.vatAmount), num(l.total),
    ]), start);
    const totalRow = sheet.getRow(start + inv.lines.length + 1);
    totalRow.getCell(2).value = L.total;
    totalRow.getCell(8).value = num(inv.totals.amount);
    totalRow.getCell(10).value = num(inv.totals.vat);
    totalRow.getCell(11).value = num(inv.totals.total);
    for (const c of [8, 10, 11]) totalRow.getCell(c).numFmt = '#,##0.00####';
    totalRow.font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: start }];
  }
  if (invoices.length === 0) workbook.addWorksheet('Счет-фактура');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ── counterparties_xlsx ────────────────────────────────────────────────────────────────────

export type CounterpartyRow = { name: string; inn: string | null; account: string | null; mfo: string | null; bankName?: string | null };

export const COUNTERPARTY_HEADERS = ['Наименование', 'ИНН', 'Расчетный счет', 'МФО', 'Банк'] as const;

export async function buildCounterpartiesXlsx(rows: readonly CounterpartyRow[], created?: Date): Promise<Buffer> {
  const workbook = newWorkbook(created);
  const sheet = workbook.addWorksheet('Контрагенты');
  const [name, inn, account, mfo, bank] = COUNTERPARTY_HEADERS;
  table(sheet, [
    { header: name, width: 50, kind: 'text' }, { header: inn, width: 16, kind: 'code' }, { header: account, width: 24, kind: 'code' },
    { header: mfo, width: 8, kind: 'code' }, { header: bank, width: 30, kind: 'text' },
  ], rows.map((r) => [text(r.name), r.inn ?? '', r.account ?? '', r.mfo ?? '', text(r.bankName)]));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

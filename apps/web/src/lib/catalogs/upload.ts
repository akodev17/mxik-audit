// What the upload wizard computes in the browser. Copies of pure @tasnivo/domain code (the web app
// does not import the domain); tests/web-parity/catalogs.test.ts keeps them equal to the originals.
import { COLUMN_FIELDS } from '@tasnivo/contracts';
import type { ColumnField, ColumnMap, ParseMeta } from './types';

export { COLUMN_FIELDS };

// ── column-map.ts ────────────────────────────────────────────────────────────────────────────

export type MappingIssue =
  | { kind: 'out_of_range'; field: ColumnField }
  | { kind: 'duplicate'; fields: ColumnField[]; column: number };

/** A column index past the header row, or one column feeding two fields (the server refuses both). */
export function mappingIssues(mapping: ColumnMap, width: number): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const byColumn = new Map<number, ColumnField[]>();
  for (const field of COLUMN_FIELDS) {
    const index = mapping[field];
    if (index < 0) continue;
    if (index >= width) { issues.push({ kind: 'out_of_range', field }); continue; }
    byColumn.set(index, [...(byColumn.get(index) ?? []), field]);
  }
  for (const [column, fields] of byColumn) {
    if (fields.length > 1) issues.push({ kind: 'duplicate', fields, column });
  }
  return issues;
}

// ── import-presets.ts ────────────────────────────────────────────────────────────────────────

export type PresetId = '1c' | 'moysklad' | 'billz';

export type ImportPreset = {
  id: PresetId;
  /** False until the headers are confirmed against a real export. */
  verified: boolean;
  /** Header names per field, compared case-insensitively, first match wins. */
  headers: Partial<Record<keyof ColumnMap, string[]>>;
};

/** Column-mapping presets for common accounting/POS exports (none verified against a real export yet). */
export const IMPORT_PRESETS: readonly ImportPreset[] = [
  {
    id: '1c',
    verified: false,
    headers: {
      name: ['Наименование', 'Наименование полное', 'Номенклатура'],
      barcode: ['Штрихкод', 'Штрих-код', 'Штрихкоды'],
      mxik: ['ИКПУ', 'Код ИКПУ', 'МХИК', 'Код МХИК'],
      unit: ['Единица измерения', 'Ед. изм.', 'Единица хранения', 'Базовая единица измерения'],
      price: ['Цена', 'Цена продажи', 'Розничная цена'],
      sales: ['Сумма продаж', 'Выручка', 'Сумма'],
    },
  },
  {
    id: 'moysklad',
    verified: false,
    headers: {
      name: ['Наименование'],
      barcode: ['Штрихкод EAN13', 'Штрихкод EAN8', 'Штрихкод', 'Штрихкод Code128'],
      mxik: ['ИКПУ', 'Код ИКПУ', 'МХИК'],
      unit: ['Единица измерения'],
      price: ['Цена: Цена продажи', 'Цена продажи'],
      sales: ['Сумма продаж', 'Выручка'],
    },
  },
  {
    id: 'billz',
    verified: false,
    headers: {
      name: ['Название', 'Наименование', 'Название товара', 'Nomi', 'Mahsulot nomi'],
      barcode: ['Баркод', 'Штрихкод', 'Barcode', 'Shtrix kod'],
      mxik: ['ИКПУ', 'IKPU', 'MXIK'],
      unit: ['Единица измерения', 'Ед. изм.', 'Oʻlchov birligi', 'Birlik'],
      price: ['Цена продажи', 'Розничная цена', 'Narx'],
      sales: ['Сумма продаж', 'Выручка', 'Sotuv summasi'],
    },
  },
];

const norm = (s: string): string => s.toLowerCase().replace(/[ʻʼ'`’]/g, '').replace(/\s+/g, ' ').trim();

/** The preset's mapping for these headers; fields it cannot find stay unmapped. */
export function applyPreset(preset: ImportPreset, headers: readonly string[], fallback: ColumnMap): ColumnMap {
  const lower = headers.map(norm);
  const find = (names: readonly string[] | undefined): number => {
    for (const name of names ?? []) {
      const i = lower.indexOf(norm(name));
      if (i >= 0) return i;
    }
    return -1;
  };
  const name = find(preset.headers.name);
  return {
    name: name >= 0 ? name : fallback.name,
    barcode: find(preset.headers.barcode),
    mxik: find(preset.headers.mxik),
    unit: find(preset.headers.unit),
    price: find(preset.headers.price),
    sales: find(preset.headers.sales),
  };
}

// ── sheet-shape.ts ───────────────────────────────────────────────────────────────────────────

/** The file line (sheet row) of a data row, 1-based as Excel shows it; null when the upload did not keep it. */
export function fileLine(info: Pick<ParseMeta, 'headerRow' | 'lineJumps'>, dataRow: number): number | null {
  if (!info.lineJumps) return null;
  let base = info.headerRow;
  let from = 0;
  for (const [row, line] of info.lineJumps) {
    if (row > dataRow) break;
    base = line;
    from = row;
  }
  return base + (dataRow - from);
}

// ── upload-file-types.ts ─────────────────────────────────────────────────────────────────────

/** .xls stays in so a legacy file reaches the parser and gets its "save as .xlsx" message. */
export const UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.csv'] as const;

/** What the drop zone promises: the formats that are read; .xls only earns the "save as .xlsx" message (B20). */
export const READ_EXTENSIONS = UPLOAD_EXTENSIONS.filter((ext) => ext !== '.xls');

/** The file input's `accept`: the extensions plus their MIME types for pickers that filter by type. */
export const UPLOAD_ACCEPT = [
  ...UPLOAD_EXTENSIONS,
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
].join(',');

/** Whether the file name ends in an accepted extension, ignoring case. */
export function hasUploadExtension(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext) && lower.length > ext.length);
}

// Column-mapping presets for common accounting/POS exports. Pure, so the
// upload form can apply them in the browser.
//
// None of these header lists could be checked against a real export or a
// published template (2026-10-16): 1C has no fixed export layout (it depends
// on the configuration and the export processing), and the MoySklad and Billz
// import/export templates are not published as text. The picker's hint asks
// the user to check the columns after applying one. Edit the header lists here
// once real files are available. Labels live in the dictionaries
// (importX.map.presets), keyed by id.
import type { ColumnMap } from './column-map';

export type PresetId = '1c' | 'moysklad' | 'billz';

export type ImportPreset = {
  id: PresetId;
  /** False until the headers are confirmed against a real export. */
  verified: boolean;
  /** Header names per field, compared case-insensitively, first match wins. */
  headers: Partial<Record<keyof ColumnMap, string[]>>;
};

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

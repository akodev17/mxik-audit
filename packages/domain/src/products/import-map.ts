// Column mapping of a product catalogue import: the first guess from header words, the 1C
// «Номенклатура» preset, and a remembered mapping resolved by header name. Pure.
//
// The 1C preset is NOT verified: its header list comes from the field names of the «Номенклатура»
// card in «1С:Бухгалтерия 8 для Узбекистана» (Наименование, Код, Артикул, Единица измерения,
// Штрихкод, and the ИКПУ / packaging fields as the brief names them: «Код из классификатора»,
// «Код упаковки»). No real export file was available on 2026-10-23, and 1C has no fixed export
// layout (it depends on the list's column settings), so the wizard says "check the columns".
import { guessMapping } from '../mapping-guess.js';

export const PRODUCT_FIELDS = ['name', 'onecRef', 'article', 'mxik', 'packageCode', 'unit', 'barcode'] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductColumnMap = Record<ProductField, number>;

export const EMPTY_MAP: ProductColumnMap = { name: 0, onecRef: -1, article: -1, mxik: -1, packageCode: -1, unit: -1, barcode: -1 };

export type ProductPreset = { id: 'onec_nomenclature'; verified: boolean; headers: Record<ProductField, string[]> };

export const PRODUCT_PRESETS: readonly ProductPreset[] = [{
  id: 'onec_nomenclature',
  verified: false,
  headers: {
    name: ['Наименование', 'Наименование полное', 'Рабочее наименование'],
    onecRef: ['Код'],
    article: ['Артикул'],
    mxik: ['Код из классификатора', 'ИКПУ', 'Код ИКПУ', 'МХИК', 'Код МХИК'],
    packageCode: ['Код упаковки', 'Упаковка (код)'],
    unit: ['Единица измерения', 'Ед. изм.', 'Базовая единица измерения', 'Единица хранения'],
    barcode: ['Штрихкод', 'Штрих-код', 'Штрихкоды'],
  },
}];

/** Lower case, apostrophes dropped, single spaces: how header names are compared. */
export const headerKey = (s: string): string => s.toLowerCase().replace(/[ʻʼ'`’‘]/g, '').replace(/\s+/g, ' ').trim();

/** The preset's mapping for these headers; null when the name column is not there. */
export function applyProductPreset(preset: ProductPreset, headers: readonly string[]): ProductColumnMap | null {
  const keys = headers.map(headerKey);
  const taken = new Set<number>();
  const find = (names: readonly string[]): number => {
    for (const n of names) {
      const i = keys.findIndex((k, j) => k === headerKey(n) && !taken.has(j));
      if (i >= 0) { taken.add(i); return i; }
    }
    return -1;
  };
  // Longer, more specific headers first ("Код упаковки" before "Код").
  const mxik = find(preset.headers.mxik);
  const packageCode = find(preset.headers.packageCode);
  const name = find(preset.headers.name);
  if (name < 0) return null;
  return {
    name, mxik, packageCode,
    article: find(preset.headers.article), unit: find(preset.headers.unit), barcode: find(preset.headers.barcode), onecRef: find(preset.headers.onecRef),
  };
}

const PACKAGE_HINTS = ['код упаков', 'qadoq kod', 'package code', 'упаковк', 'qadoq', 'қадоқ'];
const MXIK_HINTS = ['классификатор', 'mxik', 'ikpu', 'мхик', 'икпу', 'tasnif'];
const ARTICLE_HINTS = ['артикул', 'artikul', 'article', 'sku'];
/** A header that is exactly the 1C catalogue code. */
const ONEC_REF = new Set(['код', 'kod', 'код 1с', 'код 1c', '1c kod', '1с код', 'код номенклатуры', 'nomenklatura kodi']);

/** First guess: the product-specific columns by their words, then the catalogue upload's own guess for the rest. */
export function guessProductMapping(headers: readonly string[]): ProductColumnMap {
  const keys = headers.map(headerKey);
  const taken = new Set<number>();
  const take = (pred: (k: string) => boolean): number => {
    const i = keys.findIndex((k, j) => !taken.has(j) && pred(k));
    if (i >= 0) taken.add(i);
    return i;
  };
  const packageCode = take((k) => PACKAGE_HINTS.some((h) => k.includes(h)));
  const mxik = take((k) => MXIK_HINTS.some((h) => k.includes(h)));
  const article = take((k) => ARTICLE_HINTS.some((h) => k.includes(h)));
  const onecRef = take((k) => ONEC_REF.has(k));
  // The catalogue guess sees the taken columns as blank, so it cannot pick them again.
  const rest = guessMapping(headers.map((h, i) => (taken.has(i) ? '' : h)));
  const free = (i: number): number => (i >= 0 && !taken.has(i) ? i : -1);
  return {
    name: taken.has(rest.name) ? Math.max(0, keys.findIndex((_, j) => !taken.has(j))) : rest.name,
    onecRef, article, mxik: mxik >= 0 ? mxik : free(rest.mxik), packageCode, unit: free(rest.unit), barcode: free(rest.barcode),
  };
}

/** Header names per field, from a stored mapping and the headers it was made for. */
export function namedMapping(headers: readonly string[], map: Partial<Record<string, number>>): Partial<Record<ProductField, string>> {
  const out: Partial<Record<ProductField, string>> = {};
  for (const f of PRODUCT_FIELDS) {
    const i = map[f];
    if (typeof i === 'number' && i >= 0 && headers[i]) out[f] = headers[i];
  }
  return out;
}

/** A remembered mapping on new headers; null unless its name column is among them. */
export function resolveNamed(named: Partial<Record<ProductField, string>>, headers: readonly string[]): ProductColumnMap | null {
  const keys = headers.map(headerKey);
  const at = (f: ProductField): number => (named[f] ? keys.indexOf(headerKey(named[f])) : -1);
  const name = at('name');
  if (name < 0) return null;
  return { name, onecRef: at('onecRef'), article: at('article'), mxik: at('mxik'), packageCode: at('packageCode'), unit: at('unit'), barcode: at('barcode') };
}

/** A mapping usable for a file this wide: name in range, no column twice. */
export function mappingProblem(map: ProductColumnMap, width: number): 'name' | 'range' | 'duplicate' | null {
  if (map.name < 0 || map.name >= width) return 'name';
  const used = PRODUCT_FIELDS.map((f) => map[f]).filter((i) => i >= 0);
  if (used.some((i) => i >= width)) return 'range';
  return new Set(used).size === used.length ? null : 'duplicate';
}

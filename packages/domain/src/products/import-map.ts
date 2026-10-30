// Column mapping of a product catalogue import: the first guess from header words, the 1C
// «Номенклатура» preset, and a remembered mapping resolved by header name. Pure.
//
// The guess reads the header vocabulary product files are documented to use (research of
// 2026-10-30, tmp/real-docs/products/RESEARCH.md §4, every source with its URL there): RU, UZ Latin,
// UZ Cyrillic, the 1C «Номенклатура» captions (onec §1.2/§8.7), MoySklad's Uzbek card (`ИКПУ (MXIK)`,
// `Код упаковки ТАСНИФ`, `Штрихкод ТАСНИФ`), magicstore, Megagroup, CSI SetRetail (`uz-ffd-spic`,
// `uzFfdPackageCode`), Uzum's seller card, Yandex Market (`SKU`), buline.uz (`Ichki kod`, `GTIN, dona`),
// the Didox ЭСФ JSON names (`CatalogCode`, `PackageCode`, `Summa`, `VatRate`) and the fiscal item of
// Click / pay-uz (`SPIC`, `PackageCode`, `GoodPrice` in tiyin, `VATPercent`). Billz, Smartup, my.soliq
// «Справочник товаров» and Didox «Мои товары» publish no column list: they are covered by the same
// words (Наименование / ИКПУ / Код упаковки / Штрихкод / Цена / НДС), not by a verified layout.
//
// The 1C preset is NOT verified: 1C publishes captions only in release notes and no export layout
// (it depends on the list's column settings), so the wizard says "check the columns".
import { guessMapping } from '../mapping-guess.js';
import { columnName } from '../sheet-shape.js';

export const PRODUCT_FIELDS = ['name', 'onecRef', 'article', 'mxik', 'packageCode', 'unit', 'barcode', 'price', 'vat'] as const;
export type ProductField = (typeof PRODUCT_FIELDS)[number];
export type ProductColumnMap = Record<ProductField, number>;

export const EMPTY_MAP: ProductColumnMap = { name: 0, onecRef: -1, article: -1, mxik: -1, packageCode: -1, unit: -1, barcode: -1, price: -1, vat: -1 };

export type ProductPreset = { id: 'onec_nomenclature'; verified: boolean; headers: Record<ProductField, string[]> };

export const PRODUCT_PRESETS: readonly ProductPreset[] = [{
  id: 'onec_nomenclature',
  verified: false,
  headers: {
    name: ['Наименование', 'Наименование полное', 'Полное наименование', 'Рабочее наименование'],
    onecRef: ['Код'],
    article: ['Артикул'],
    mxik: ['Код из классификатора', 'ИКПУ', 'Код ИКПУ', 'МХИК', 'Код МХИК'],
    packageCode: ['Код упаковки', 'Упаковка (код)', 'Упаковка (ЭДО)', 'Упаковка ЭДО'],
    unit: ['Единица измерения', 'Ед. изм.', 'Базовая единица измерения', 'Единица хранения'],
    barcode: ['Штрихкод', 'Штрих-код', 'Штрихкоды'],
    price: ['Цена'],
    vat: ['Ставка НДС', '% НДС'],
  },
}];

/** Lower case, apostrophes dropped, single spaces: how header names are compared. */
export const headerKey = (s: string): string => s.toLowerCase().replace(/[ʻʼ'`’‘]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Exact header names per field, most specific first (products §4, §7.29). A header equal to one of
 * them (after headerKey) is taken before any word hint.
 */
export const HEADER_VOCABULARY: Record<ProductField, readonly string[]> = {
  name: [
    'наименование', 'наименование товара', 'наименование номенклатуры', 'полное наименование', 'наименование полное', 'рабочее наименование',
    'название', 'название товара', 'товар', 'номенклатура', 'name', 'product name', 'item name',
    'nomi', 'nom', 'nomlanishi', 'mahsulot nomi', 'tovar nomi', 'номи', 'номланиши', 'маҳсулот номи', 'товар номи',
  ],
  onecRef: ['код', 'код 1с', 'код 1c', 'код номенклатуры', 'kod', '1c kod', '1с код', 'nomenklatura kodi'],
  article: [
    'артикул', 'sku', 'sku товара', 'ваш sku', 'артикул продавца', 'внешний код', 'код товара', 'id', 'id товара',
    'ichki kod', 'ichki kodi', 'artikul', 'ички код', 'ички коди', 'артикули', 'article', 'vendor code',
  ],
  mxik: [
    'икпу', 'икпу (mxik)', 'код икпу', 'код из классификатора', 'идентификационный код', 'мхик', 'код мхик',
    'mxik', 'mxik kodi', 'mxik kod', 'ikpu', 'мхик коди', 'мхик код', 'catalogcode', 'catalog code', 'spic', 'uz-ffd-spic', 'tasnif kodi',
  ],
  packageCode: [
    'код упаковки', 'код упаковки тасниф', 'код упаковки units', 'упаковка (код)', 'упаковка (эдо)', 'упаковка эдо',
    'packagecode', 'package code', 'uzffdpackagecode', 'qadoq kodi', 'qadoq kod', 'қадоқ коди', 'қадоқ код',
  ],
  unit: [
    'единица измерения', 'единицы измерения', 'ед. изм.', 'ед.изм.', 'ед изм', 'ед.', 'базовая единица измерения', 'единица хранения',
    'olchov birligi', 'olchov birlik', 'birlik', 'ўлчов бирлиги', 'ўлчов бирлик', 'units', 'unit', 'measure',
  ],
  barcode: [
    'штрихкод', 'штрих-код', 'штрих код', 'штрихкоды', 'barcode', 'gtin', 'gtin, dona', 'ean', 'ean-13',
    'shtrix kod', 'shtrix-kod', 'shtrixkod', 'штрих коди', 'штрихкоди', 'штрихкод тасниф',
  ],
  price: [
    'goodprice', 'цена', 'цена продажи', 'цена с ндс', 'цена без ндс', 'розничная цена', 'отпускная цена', 'summa',
    'narx', 'narxi', 'sotuv narxi', 'нарх', 'нархи', 'сотув нархи', 'price', 'стоимость',
  ],
  vat: ['ставка ндс', '% ндс', 'vatpercent', 'vatrate', 'vat rate', 'ндс', 'qqs', 'qqs stavkasi', 'ққс', 'ққс ставкаси', 'vat', 'ндс %', 'ндс, %'],
};

/** Price columns whose amounts are integer tiyin (Click / pay-uz `GoodPrice`), not sums. */
export const TIYIN_PRICE_HEADERS: ReadonlySet<string> = new Set(['goodprice']);

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
  const vat = find(preset.headers.vat);
  const name = find(preset.headers.name);
  if (name < 0) return null;
  return {
    name, mxik, packageCode, vat,
    article: find(preset.headers.article), unit: find(preset.headers.unit), barcode: find(preset.headers.barcode), onecRef: find(preset.headers.onecRef),
    price: find(preset.headers.price),
  };
}

const PACKAGE_HINTS = ['код упаков', 'qadoq kod', 'package code', 'packagecode', 'упаковк', 'qadoq', 'қадоқ'];
const MXIK_HINTS = ['классификатор', 'mxik', 'ikpu', 'мхик', 'икпу', 'tasnif', 'spic', 'catalogcode'];
const ARTICLE_HINTS = ['артикул', 'artikul', 'article', 'sku', 'ichki kod', 'ички код'];
const PRICE_HINTS = ['цена', 'narx', 'нарх', 'price', 'стоим', 'summa'];
const VAT_HINTS = ['ндс', 'qqs', 'ққс', 'vat'];
/** A header that is exactly the 1C catalogue code. */
const ONEC_REF = new Set(HEADER_VOCABULARY.onecRef);

/** Field order of the exact pass: identifiers before the name, so "Код упаковки" is never a name. */
const EXACT_ORDER: readonly ProductField[] = ['packageCode', 'mxik', 'article', 'onecRef', 'barcode', 'unit', 'vat', 'price', 'name'];

/**
 * First guess: exact vocabulary names, then the product-specific words, then the catalogue upload's
 * own guess for the rest. A column is never taken twice; columns nothing names stay unmapped.
 */
export function guessProductMapping(headers: readonly string[]): ProductColumnMap {
  const keys = headers.map(headerKey);
  const taken = new Set<number>();
  const out: ProductColumnMap = { name: -1, onecRef: -1, article: -1, mxik: -1, packageCode: -1, unit: -1, barcode: -1, price: -1, vat: -1 };
  for (const field of EXACT_ORDER) {
    for (const word of HEADER_VOCABULARY[field]) {
      const i = keys.findIndex((k, j) => !taken.has(j) && k === word);
      if (i >= 0) { out[field] = i; taken.add(i); break; }
    }
  }
  const take = (field: ProductField, pred: (k: string) => boolean): void => {
    if (out[field] >= 0) return;
    const i = keys.findIndex((k, j) => !taken.has(j) && pred(k));
    if (i >= 0) { taken.add(i); out[field] = i; }
  };
  take('packageCode', (k) => PACKAGE_HINTS.some((h) => k.includes(h)));
  take('mxik', (k) => MXIK_HINTS.some((h) => k.includes(h)));
  take('article', (k) => ARTICLE_HINTS.some((h) => k.includes(h)));
  take('onecRef', (k) => ONEC_REF.has(k));
  // "Цена с НДС" is a price, "Ставка НДС" a rate: the rate column names VAT and no price word.
  take('vat', (k) => VAT_HINTS.some((h) => k.includes(h)) && !PRICE_HINTS.some((h) => k.includes(h)) && !k.includes('сумма'));
  take('price', (k) => PRICE_HINTS.some((h) => k.includes(h)));
  // The catalogue guess sees the taken columns as blank, so it cannot pick them again.
  const rest = guessMapping(headers.map((h, i) => (taken.has(i) ? '' : h)));
  const free = (i: number): number => (i >= 0 && !taken.has(i) ? i : -1);
  if (out.mxik < 0) out.mxik = free(rest.mxik);
  if (out.unit < 0) out.unit = free(rest.unit);
  if (out.barcode < 0) out.barcode = free(rest.barcode);
  if (out.name < 0) out.name = taken.has(rest.name) ? Math.max(0, keys.findIndex((_, j) => !taken.has(j))) : rest.name;
  return out;
}

/** How many of a row's cells are a known header name: a header row scores high, a data row near 0. */
export function headerScore(row: readonly string[]): number {
  const known = new Set(Object.values(HEADER_VOCABULARY).flat());
  return row.filter((c) => known.has(headerKey(c))).length;
}

/** Rows below the reader's header that are searched for the real one. */
const HEADER_SEARCH = 15;

/**
 * The header row by vocabulary (products §7.29): the reader takes the first row as wide as the table,
 * which is a title or an instruction line in some exports (a 1C list with a caption row, a template
 * with a hint row). When a row within the first HEADER_SEARCH data rows names at least two product
 * columns and more than the reader's header does, it becomes the header and the rows above it are
 * dropped. `skipped` counts them.
 */
export function locateHeader(headers: readonly string[], rows: readonly string[][]): { headers: string[]; rows: string[][]; skipped: number } {
  let best = -1;
  let bestScore = headerScore(headers);
  rows.slice(0, HEADER_SEARCH).forEach((row, i) => {
    const score = headerScore(row);
    if (score >= 2 && score > bestScore) [best, bestScore] = [i, score];
  });
  if (best < 0) return { headers: [...headers], rows: [...rows], skipped: 0 };
  const head = rows[best] ?? [];
  const data = rows.slice(best + 1);
  const width = data.reduce((w, r) => Math.max(w, r.length), head.length);
  return { headers: Array.from({ length: width }, (_, i) => (head[i]?.trim() ? head[i] : columnName(i))), rows: data, skipped: best + 1 };
}

/** `primary`'s columns, and `fallback`'s for the fields `primary` leaves out (never a column twice). */
export function mergeMappings(primary: ProductColumnMap, fallback: ProductColumnMap): ProductColumnMap {
  const used = new Set(PRODUCT_FIELDS.map((f) => primary[f]).filter((i) => i >= 0));
  const out = { ...primary };
  for (const f of PRODUCT_FIELDS) {
    const i = fallback[f];
    if (out[f] < 0 && i >= 0 && !used.has(i)) { out[f] = i; used.add(i); }
  }
  return out;
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
  return {
    name, onecRef: at('onecRef'), article: at('article'), mxik: at('mxik'), packageCode: at('packageCode'), unit: at('unit'), barcode: at('barcode'),
    price: at('price'), vat: at('vat'),
  };
}

/** A mapping usable for a file this wide: name in range, no column twice. */
export function mappingProblem(map: ProductColumnMap, width: number): 'name' | 'range' | 'duplicate' | null {
  if (map.name < 0 || map.name >= width) return 'name';
  const used = PRODUCT_FIELDS.map((f) => map[f]).filter((i) => i >= 0);
  if (used.some((i) => i >= width)) return 'range';
  return new Set(used).size === used.length ? null : 'duplicate';
}

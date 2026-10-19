// First guess at the column mapping from header keywords, in both scripts. Pure.
import type { ColumnField, ColumnMap } from './column-map';

/** Header keywords that identify each field. */
const HINTS: Record<ColumnField, string[]> = {
  name: ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'продукт', 'name', 'product'],
  barcode: ['shtrix', 'shtrih', 'штрих', 'barcode', 'ean', 'gtin', 'bar code'],
  mxik: ['mxik', 'ikpu', 'мхик', 'икпу', 'spic', 'tasnif'],
  unit: ['birlik', 'oʻlchov', 'olchov', 'единиц', 'изм', 'unit', 'uom'],
  price: ['narx', 'цена', 'price', 'summa', 'сумма', 'стоим'],
  sales: ['sotuv summa', 'savdo summa', 'сумма продаж', 'сумма реализ', 'выручк', 'sales'],
};

export function guessMapping(headers: readonly string[]): ColumnMap {
  const lower = headers.map((h) => h.toLowerCase());
  const taken = new Set<number>();
  const find = (field: ColumnField): number => {
    const hints = HINTS[field];
    for (let i = 0; i < lower.length; i++) {
      const h = lower[i] ?? '';
      if (!taken.has(i) && hints.some((hint) => h.includes(hint))) {
        taken.add(i);
        return i;
      }
    }
    return -1;
  };
  // Codes and barcodes first: "MXIK kodi" must not be read as a name, nor "Sotuv summasi" as a price.
  const mxik = find('mxik');
  const barcode = find('barcode');
  const sales = find('sales');
  const unit = find('unit');
  const name = find('name');
  const price = find('price');
  // The name column is required; fall back to the first free column.
  const fallback = lower.findIndex((_, i) => !taken.has(i));
  return { name: name === -1 ? Math.max(0, fallback) : name, barcode, mxik, unit, price, sales };
}

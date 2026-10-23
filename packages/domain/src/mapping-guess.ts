// First guess at the column mapping from header keywords, in both scripts. Pure.
import type { ColumnField, ColumnMap } from './column-map';

/** Header keywords that identify each field. */
const HINTS: Record<ColumnField, string[]> = {
  name: ['nom', 'tovar', 'mahsulot', 'наимен', 'товар', 'продукт', 'номенклатур', 'nomenklatur', 'name', 'product'],
  barcode: ['shtrix', 'shtrih', 'штрих', 'barcode', 'ean', 'gtin', 'bar code'],
  mxik: ['mxik', 'ikpu', 'мхик', 'икпу', 'spic', 'tasnif'],
  // TIF TN is the Uzbek name of TN VED (ТН ВЭД), the customs edition of the HS. Spelled out, it also names
  // the "nomenklatura" the name hints look for, so it is found before the name column.
  tnved: [
    'tif tn', 'tif-tn', 'tiftn', 'tn ved', 'tn-ved', 'tnved', 'тн вэд', 'тн-вэд', 'тнвэд', 'тн вед', 'код тн',
    'hs code', 'hs kod', 'hs-code', 'tashqi iqtisodiy', 'внешнеэкономическ',
  ],
  // "Ед." is how 1C and most price lists abbreviate the unit column; "ед" alone would also match "среднее".
  unit: ['birlik', 'birl', 'oʻlchov', 'o‘lchov', "o'lchov", 'olchov', 'единиц', 'изм', 'ед.', 'unit', 'uom'],
  price: ['narx', 'цена', 'price', 'summa', 'сумма', 'стоим'],
  sales: ['sotuv summa', 'savdo summa', 'сумма продаж', 'сумма реализ', 'выручк', 'sales'],
};

/**
 * Words that name the product name column itself. A header equal to one of them, or containing one as
 * whole words ("Mahsulot nomi"), beats a header that merely contains a name hint ("Tovar guruhi").
 */
const NAME_WORDS = [
  'nomi', 'nom', 'nomlanishi', 'tovar nomi', 'mahsulot nomi', 'nomenklatura',
  'наименование', 'название', 'наименование товара', 'номенклатура', 'наименование номенклатуры',
  'name', 'product name', 'item name',
];

/**
 * Headers that hold an identifier, never a product name: when nothing names the product, the
 * fallback must skip these ("Код" in a 1C export is the row's own code, not the name).
 */
// `\b` is ASCII-only in JavaScript, so the word end is spelled out for Cyrillic headers.
const IDENTIFIER_HEADER = /^(код|kod|kodi|артикул|artikul|art|sku|id|№|n|номер|raqam|number)(?:$|[^\p{L}\p{N}])/u;

/** Lower case, words separated by single spaces, punctuation dropped. */
const words = (s: string): string => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');

/** 3 = the header is a name word, 2 = it contains one as whole words, 1 = it contains a name hint, 0 = none. */
function nameScore(header: string): number {
  const h = words(header);
  if (NAME_WORDS.includes(h)) return 3;
  if (NAME_WORDS.some((w) => ` ${h} `.includes(` ${w} `))) return 2;
  return HINTS.name.some((hint) => header.toLowerCase().includes(hint)) ? 1 : 0;
}

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
  // The best scoring free column; the first one wins a tie.
  const findName = (): number => {
    let best = -1;
    let bestScore = 0;
    headers.forEach((h, i) => {
      const score = taken.has(i) ? 0 : nameScore(h);
      if (score > bestScore) [best, bestScore] = [i, score];
    });
    if (best !== -1) taken.add(best);
    return best;
  };
  // Codes and barcodes first: "MXIK kodi" must not be read as a name, nor "Sotuv summasi" as a price.
  const mxik = find('mxik');
  const tnved = find('tnved');
  const barcode = find('barcode');
  const sales = find('sales');
  const unit = find('unit');
  const name = findName();
  const price = find('price');
  // The name column is required; fall back to the first free column that is not an identifier,
  // then to the first free column at all.
  const free = (i: number): boolean => !taken.has(i);
  const isIdentifier = (h: string): boolean => IDENTIFIER_HEADER.test(h.trim()) || IDENTIFIER_HEADER.test(words(h));
  const fallback = lower.findIndex((h, i) => free(i) && !isIdentifier(h));
  const anyFree = lower.findIndex((_, i) => free(i));
  return { name: name === -1 ? Math.max(0, fallback === -1 ? anyFree : fallback) : name, barcode, mxik, tnved, unit, price, sales };
}

// Groups review rows that are the same product in different packs, e.g.
// "Сахар-песок 10 кг" and "Сахар-песок 50 кг мешок". Pure.
import { matchKeyOf, normalizeName } from '../normalize/index.js';

/** Packaging and count words, folded to Latin; they say how it is sold, not what it is. */
const PACKAGING = new Set([
  'meshok', 'meshke', 'paket', 'paketi', 'pet', 'butilka', 'butylka', 'banka', 'korobka', 'upakovka',
  'yashik', 'yashchik', 'kanistra', 'flakon', 'tuba', 'pachka', 'blok', 'rulon', 'vedro', 'bochka',
  'tara', 'sht', 'dona', 'qop', 'xalta', 'quti', 'shisha', 'idish', 'qadoq', 'qadoqlangan',
  'ves', 'vesovoy', 'vesovaya', 'razves', 'fasovka', 'fasovannyy', 'fas', 'kg', 'gr', 'l', 'ml',
].map(matchKeyOf));

/** The product stem: the folded name without pack sizes, numbers or packaging words. */
export function productStem(name: string): string {
  const { queryKey } = normalizeName(name);
  return queryKey.split(' ')
    .filter((w) => w.length > 1 && !/^\d/.test(w) && !PACKAGING.has(w))
    .join(' ');
}

export type GroupableFinding = {
  productName: string;
  type: string;
  suggestedMxik: string | null;
  split: boolean;
};

/**
 * Rows share a key when their stems and suggested codes match. A unit fix is
 * a different action from a code change, so the two never share a group. Rows
 * the user split out, or with nothing suggested, get no key.
 */
export function groupKeyOf(f: GroupableFinding): string | null {
  if (f.split || !f.suggestedMxik) return null;
  const stem = productStem(f.productName);
  if (!stem) return null;
  const action = f.type === 'UNIT_CONFLICT' ? 'unit' : 'code';
  return `${action}|${f.suggestedMxik}|${stem}`;
}

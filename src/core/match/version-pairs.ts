// Pairs the rows of a catalogue with the rows of its previous version: the
// same row identity first, then barcode, then folded name + unit, then the same
// row number with the same folded name. Each previous row is used once. Pure.
import { normalizeName } from '../normalize/index.js';
import { dictionaryKeys } from './dictionary.js';

const folded = (i: { rawName: string }): string => normalizeName(i.rawName).sortedKey;

export type VersionItem = {
  id: string;
  rowIndex: number;
  rawName: string;
  unit: string | null;
  barcode: string | null;
  existingMxik: string | null;
};

export type Pairing = {
  pairs: { prev: VersionItem; next: VersionItem; by: 'barcode' | 'name' | 'row' }[];
  added: VersionItem[];
  removed: VersionItem[];
};

/**
 * Everything that makes a row the same product with the same code: folded
 * words, pack size and other attributes the fold strips (0.5 L vs 1.5 L), unit,
 * identifying barcode and code. Null when the name folds to nothing, so such a
 * row is never treated as unchanged.
 */
export function identityKey(i: VersionItem): string | null {
  const n = normalizeName(i.rawName);
  if (!n.sortedKey) return null;
  const keys = dictionaryKeys(i);
  const a = n.attrs;
  return [
    n.sortedKey, keys.unit ?? '', keys.barcode ?? '',
    a.volumeMl, a.weightG, a.lengthMm, a.packCount, a.percent, a.dimensions, [...a.vendorCodes].sort().join(','),
    (i.existingMxik ?? '').replace(/\D/g, ''),
  ].join('|');
}

/** Same product, same pack, unit, barcode and code: nothing a reviewer needs to look at again. */
export function unchanged(a: VersionItem, b: VersionItem): boolean {
  const key = identityKey(a);
  return key !== null && key === identityKey(b);
}

export function pairVersions(prev: readonly VersionItem[], next: readonly VersionItem[]): Pairing {
  const used = new Set<string>();
  const pairs: Pairing['pairs'] = [];
  const pending: VersionItem[] = [];

  const index = (pick: (item: VersionItem) => string | null): Map<string, VersionItem[]> => {
    const map = new Map<string, VersionItem[]>();
    for (const item of prev) {
      const key = pick(item);
      if (key) map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  };
  const byIdentity = index(identityKey);
  const byBarcode = index((i) => dictionaryKeys(i).barcode);
  const byName = index((i) => dictionaryKeys(i).name);
  const byRow = new Map(prev.map((p) => [`${p.rowIndex}|${folded(p)}`, p]));

  const take = (candidates: VersionItem[] | undefined): VersionItem | null => {
    const hit = candidates?.find((c) => !used.has(c.id)) ?? null;
    if (hit) used.add(hit.id);
    return hit;
  };

  // Identical rows first, so duplicates that differ only in pack size pair with their twin.
  const rest: VersionItem[] = [];
  for (const item of next) {
    const key = identityKey(item);
    const same = key ? take(byIdentity.get(key)) : null;
    if (same) pairs.push({ prev: same, next: item, by: dictionaryKeys(item).barcode ? 'barcode' : 'name' });
    else rest.push(item);
  }

  for (const item of rest) {
    const keys = dictionaryKeys(item);
    const viaBarcode = keys.barcode ? take(byBarcode.get(keys.barcode)) : null;
    if (viaBarcode) { pairs.push({ prev: viaBarcode, next: item, by: 'barcode' }); continue; }
    const viaName = keys.name ? take(byName.get(keys.name)) : null;
    if (viaName) { pairs.push({ prev: viaName, next: item, by: 'name' }); continue; }
    pending.push(item);
  }

  const added: VersionItem[] = [];
  for (const item of pending) {
    const name = folded(item);
    const sameRow = name ? byRow.get(`${item.rowIndex}|${name}`) : undefined;
    if (sameRow && !used.has(sameRow.id)) { used.add(sameRow.id); pairs.push({ prev: sameRow, next: item, by: 'row' }); } else added.push(item);
  }
  pairs.sort((a, b) => a.next.rowIndex - b.next.rowIndex);
  return { pairs, added, removed: prev.filter((p) => !used.has(p.id)) };
}

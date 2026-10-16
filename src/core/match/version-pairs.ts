// Pairs the rows of a catalogue with the rows of its previous version:
// barcode first, then folded name + unit, then the same row number with the
// same folded name. Each previous row is used once. Pure.
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

/** Same product, same unit, same code: nothing a reviewer needs to look at again. */
export function unchanged(a: VersionItem, b: VersionItem): boolean {
  const key = (i: VersionItem): string => `${dictionaryKeys(i).name}|${i.existingMxik ?? ''}`;
  return key(a) === key(b);
}

export function pairVersions(prev: readonly VersionItem[], next: readonly VersionItem[]): Pairing {
  const used = new Set<string>();
  const pairs: Pairing['pairs'] = [];
  const pending: VersionItem[] = [];

  const index = (pick: (k: ReturnType<typeof dictionaryKeys>) => string | null): Map<string, VersionItem[]> => {
    const map = new Map<string, VersionItem[]>();
    for (const item of prev) {
      const key = pick(dictionaryKeys(item));
      if (key) map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  };
  const byBarcode = index((k) => k.barcode);
  const byName = index((k) => k.name);
  const byRow = new Map(prev.map((p) => [`${p.rowIndex}|${folded(p)}`, p]));

  const take = (candidates: VersionItem[] | undefined): VersionItem | null => {
    const hit = candidates?.find((c) => !used.has(c.id)) ?? null;
    if (hit) used.add(hit.id);
    return hit;
  };

  for (const item of next) {
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
  return { pairs, added, removed: prev.filter((p) => !used.has(p.id)) };
}

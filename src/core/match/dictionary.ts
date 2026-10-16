// The firm dictionary's keys: what an org confirmed before, found again by
// barcode or by normalised name + unit. Pure.
import { normalizeBarcode, normalizeName } from '../normalize/index.js';
import { resolveUnit } from '../normalize/units.js';

export type DictionaryKeys = {
  barcode: string | null;
  /** Folded name plus canonical unit; null when the name folds to nothing. */
  name: string | null;
  label: string;
  unit: string | null;
};

export type DictionaryEntry = { id: string; code: string; uses: number };

/** Lookup supplied by the caller (the audit preloads an org's dictionary). */
export type DictionaryLookup = {
  find(keys: DictionaryKeys): DictionaryEntry | null;
};

export function dictionaryKeys(input: { rawName: string; unit?: string | null; barcode?: string | null }): DictionaryKeys {
  const normalized = normalizeName(input.rawName);
  const resolved = resolveUnit(input.unit ?? null);
  const unit = resolved ? String(resolved.id) : (input.unit?.trim().toLowerCase() || null);
  return {
    barcode: normalizeBarcode(input.barcode),
    name: normalized.sortedKey ? `${normalized.sortedKey}|${unit ?? ''}` : null,
    label: normalized.display,
    unit,
  };
}

// The firm dictionary's keys: what an org confirmed before, found again by
// barcode or by normalised name + unit. Pure.
import { identifyingBarcode, normalizeName } from '../normalize/index.js';
import { resolveUnit } from '../normalize/units.js';

export type DictionaryKeys = {
  /** Only a barcode that identifies a product (valid check digit, not in-store) is a key. */
  barcode: string | null;
  /** Folded name plus canonical unit; null when the name folds to nothing. */
  name: string | null;
  label: string;
  unit: string | null;
};

export type DictionaryEntry = {
  id: string;
  code: string;
  /** How often the entry was learned, bulk accepts included. */
  uses: number;
  /** Which key found it. */
  kind?: 'barcode' | 'name';
  /** Individual or group decisions behind it; only these make it eligible for auto-accept. */
  confirmations?: number;
};

/** Lookup supplied by the caller (the audit preloads an org's dictionary). */
export type DictionaryLookup = {
  find(keys: DictionaryKeys): DictionaryEntry | null;
};

/** Auto-accept trusts an entry only after at least one individual confirmation. */
export const AUTO_ACCEPT_MIN_CONFIRMATIONS = 1;

export function dictionaryKeys(input: { rawName: string; unit?: string | null; barcode?: string | null }): DictionaryKeys {
  const normalized = normalizeName(input.rawName);
  const resolved = resolveUnit(input.unit ?? null);
  const unit = resolved ? String(resolved.id) : (input.unit?.trim().toLowerCase() || null);
  return {
    barcode: identifyingBarcode(input.barcode),
    name: normalized.sortedKey ? `${normalized.sortedKey}|${unit ?? ''}` : null,
    label: normalized.display,
    unit,
  };
}

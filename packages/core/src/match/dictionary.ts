// The firm dictionary's keys: what an org confirmed before, found again by
// barcode or by normalised name + size attributes + unit. Pure.
import { attrsKey, identifyingBarcode, normalizeName } from '../normalize/index.js';
import { resolveUnit } from '../normalize/units.js';

export type DictionaryKeys = {
  /** Only a barcode that identifies a product (valid check digit, not in-store) is a key. */
  barcode: string | null;
  /**
   * Folded name, its size attributes and the canonical unit (`sortedKey|attrs|unit`); null when the
   * name folds to nothing. The attributes keep "Sut 3.2% 1l" and "Sut 2.5% 1l" apart.
   */
  name: string | null;
  /** attrsKey() of the name: volume, weight, length, pack count, percent, dimensions, model codes. */
  attrs: string;
  label: string;
  unit: string | null;
};

/** Why an entry may be suggested but is never trusted on its own until a person looks again. */
export type DictionaryHold = 'reconfirm' | 'disputed';

export type DictionaryEntry = {
  id: string;
  code: string;
  /** How often the entry was learned, bulk accepts included. */
  uses: number;
  /** Which key found it. */
  kind?: 'barcode' | 'name';
  /** Individual or group decisions behind it; only these make it eligible for auto-accept. */
  confirmations?: number;
  /** Set while the entry needs a fresh confirmation or was reported wrong; auto-accept skips it. */
  hold?: DictionaryHold;
};

/** Lookup supplied by the caller (the audit preloads an org's dictionary). */
export type DictionaryLookup = {
  find(keys: DictionaryKeys): DictionaryEntry | null;
};

/** Auto-accept trusts an entry only after at least one individual confirmation. */
export const AUTO_ACCEPT_MIN_CONFIRMATIONS = 1;

/** The name key; every writer and reader of firm_mapping goes through here. */
export function nameKeyOf(sortedKey: string, attrs: string, unit: string | null): string | null {
  return sortedKey ? `${sortedKey}|${attrs}|${unit ?? ''}` : null;
}

export function dictionaryKeys(input: { rawName: string; unit?: string | null; barcode?: string | null }): DictionaryKeys {
  const normalized = normalizeName(input.rawName);
  const resolved = resolveUnit(input.unit ?? null);
  const unit = resolved ? String(resolved.id) : (input.unit?.trim().toLowerCase() || null);
  const attrs = attrsKey(normalized.attrs);
  return {
    barcode: identifyingBarcode(input.barcode),
    name: nameKeyOf(normalized.sortedKey, attrs, unit),
    attrs,
    label: normalized.display,
    unit,
  };
}

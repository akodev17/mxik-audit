// The keys a product is stored and found by. Pure, so the matcher, the upsert and the tests agree.
//
// The product name key is NOT the MXIK matcher's match key: normalizeName() strips sizes and
// pack counts ("Coca-Cola 1,5л" and "Coca-Cola 0,5л" fold to the same key), which is right for
// finding a classifier code and wrong for telling two products of a catalogue apart. This key
// folds script, case, apostrophes and punctuation (matchKeyOf) and keeps every number, split from
// its unit so "50kg" and "50 kg" agree.
import { identifyingBarcode, matchKeyOf, resolveUnit } from '@tasnivo/core/normalize/index';

export function productNameKey(name: string): string {
  return matchKeyOf(name)
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The official unit id as text when the unit resolves, else the lower-cased unit; '' when none. */
export function unitKeyOf(unit: string | null | undefined): string {
  const raw = unit?.trim() ?? '';
  if (!raw) return '';
  const resolved = resolveUnit(raw);
  return resolved ? String(resolved.id) : raw.toLowerCase();
}

/**
 * The barcode as stored and compared: the GTIN-14 when it is a product identity (valid length and
 * check digit, not an in-store number), otherwise the digits as given (kept, never matched on).
 */
export function barcodeKey(barcode: string | null | undefined): { stored: string | null; identity: string | null } {
  const raw = barcode?.trim() ?? '';
  if (!raw) return { stored: null, identity: null };
  const identity = identifyingBarcode(raw);
  return { stored: identity ?? raw, identity };
}

/** Every number in a name key, in order: two products whose numbers differ are never the same product by similarity. */
export function numbersOf(key: string): string {
  return (key.match(/\d+/g) ?? []).join(' ');
}

/** 17 digits after dropping separators; null for anything else (and for nothing). */
export function mxikOf(raw: string | null | undefined): { code: string | null; malformed: boolean } {
  if (!raw || !raw.trim()) return { code: null, malformed: false };
  const digits = raw.replace(/[\s.\-–]/g, '');
  return /^\d{17}$/.test(digits) ? { code: digits, malformed: false } : { code: null, malformed: true };
}

// GTIN handling: length, check digit, and whether the number identifies a
// product at all. Pure.

/** Normalizes a GTIN to 14 digits, or null when the input cannot be one. Length only. */
export function normalizeBarcode(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  // Gate 0 found 39 catalogue barcodes at 10-11 digits: not valid GTIN lengths.
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits.padStart(14, '0');
}

/** GS1 mod-10 check over a 14-digit GTIN: weights 3,1,3,… from the left of the padded form. */
export function hasValidCheckDigit(gtin14: string): boolean {
  if (!/^\d{14}$/.test(gtin14)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(gtin14[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(gtin14[13]);
}

/**
 * Restricted-circulation numbers: GS1 prefixes 02, 04 and 20-29 of an EAN-13
 * (and the same numbers padded to GTIN-14, which covers UPC-A 2… and 4…).
 * Shops and producers assign them internally, often with a weight or price
 * inside, so the same number means different goods in different places.
 */
export function isRestrictedCirculation(gtin14: string): boolean {
  return /^(02|04|2)/.test(gtin14.slice(1));
}

export type BarcodeStatus = 'absent' | 'bad_length' | 'bad_check_digit' | 'restricted' | 'ok';

export type BarcodeIdentity = {
  status: BarcodeStatus;
  /** The 14-digit GTIN, set only when it identifies a product (status `ok`). */
  gtin: string | null;
};

/** Whether a row's barcode can stand for the product, and why not when it cannot. */
export function barcodeIdentity(input: string | null | undefined): BarcodeIdentity {
  if (!input || input.replace(/\D/g, '') === '') return { status: 'absent', gtin: null };
  const gtin = normalizeBarcode(input);
  if (!gtin) return { status: 'bad_length', gtin: null };
  if (!hasValidCheckDigit(gtin)) return { status: 'bad_check_digit', gtin: null };
  if (isRestrictedCirculation(gtin)) return { status: 'restricted', gtin: null };
  return { status: 'ok', gtin };
}

/** The 14-digit GTIN when the barcode identifies a product, otherwise null. */
export function identifyingBarcode(input: string | null | undefined): string | null {
  return barcodeIdentity(input).gtin;
}

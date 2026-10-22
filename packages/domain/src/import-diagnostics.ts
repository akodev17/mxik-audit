// What an upload will turn into under a given mapping, before anything is
// audited: rows that will be dropped, duplicates, placeholder and malformed
// codes, amounts that could be read two ways, and what the reader skipped.
// Code cells are read like the audit reads them (readCode): no digits at all
// is no code (MISSING), digits of the wrong length a code the classifier will
// not have (NOT_FOUND). Pure; computed on the server and stored on
// Catalog.importMeta with the final mapping.
import { attrsKey, normalizeName } from '../core/normalize/index.js';
import { identifyingBarcode } from '../core/normalize/barcode.js';
import { readAmount } from './amount.js';
import type { ColumnField, ColumnMap } from './column-map.js';
import type { ParseMeta } from './spreadsheet.js';

/** Row numbers kept as examples (1-based, counting data rows below the header). */
const SAMPLE = 5;

type Counted = { count: number; sample: number[] };

export type ImportDiagnostics = {
  /** Data rows read from the file (after the header). */
  rows: number;
  /** Rows that will be audited: those with a product name. */
  importable: number;
  /** Rows without a name in the name column; they are not imported. */
  noName: Counted;
  /** Rows repeating an earlier row's name, sizes, unit and barcode. */
  duplicates: Counted & { groups: number };
  /** Non-empty code cells without a single digit ("-", "yoʻq", "нет"): audited as having no code (MISSING). */
  noCode: Counted;
  /** Code cells with digits, but not 17 of them: audited as not in the classifier (NOT_FOUND). */
  badCodes: Counted;
  /** Of those, 16-digit codes: most likely a leading zero lost in Excel. */
  lostZero: Counted;
  /** Price or sales cells like "12,500" that read as thousands but could be decimals. */
  ambiguousAmounts: Counted;
};

export type ImportMeta = {
  parse: ParseMeta;
  /** For the mapping in use: the suggestion's at upload, the confirmed one after commit. */
  diagnostics: ImportDiagnostics;
  /** Where the suggested mapping came from when the upload was read. */
  remembered: 'client' | 'org' | null;
  /** Per field: remembered, guessed or unmapped in that suggestion. */
  fields?: Record<ColumnField, 'remembered' | 'guess' | 'none'>;
};

const counted = (): Counted => ({ count: 0, sample: [] });
const note = (c: Counted, row: number): void => {
  c.count++;
  if (c.sample.length < SAMPLE) c.sample.push(row);
};

const cell = (row: readonly string[], index: number): string => (index < 0 ? '' : (row[index] ?? '').trim());

export function importDiagnostics(rows: readonly (readonly string[])[], mapping: ColumnMap): ImportDiagnostics {
  const noName = counted();
  const duplicates = { ...counted(), groups: 0 };
  const noCode = counted();
  const badCodes = counted();
  const lostZero = counted();
  const ambiguousAmounts = counted();
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const n = i + 1;
    const name = cell(row, mapping.name);
    if (name === '') { note(noName, n); return; }

    const unit = cell(row, mapping.unit).toLowerCase();
    const rawBarcode = cell(row, mapping.barcode);
    const barcode = identifyingBarcode(rawBarcode) ?? rawBarcode.replace(/\D/g, '');
    // The match key drops sizes, so they come back from the attributes: "Труба ВГП 15х2,5"
    // and "Труба ВГП 20х2,5" are two products, "Coca-Cola 1.5L" and "Coca Cola 1,5 l" one.
    const normalized = normalizeName(name);
    const key = `${normalized.matchKey}|${attrsKey(normalized.attrs)}|${unit}|${barcode}`;
    const times = seen.get(key) ?? 0;
    if (times > 0) {
      note(duplicates, n);
      if (times === 1) duplicates.groups++;
    }
    seen.set(key, times + 1);

    const code = cell(row, mapping.mxik);
    if (code !== '') {
      const digits = code.replace(/\D/g, '');
      if (digits.length === 0) note(noCode, n);
      else if (digits.length !== 17) note(badCodes, n);
      if (digits.length === 16) note(lostZero, n);
    }

    const amounts = [cell(row, mapping.price), cell(row, mapping.sales)];
    if (amounts.some((a) => a !== '' && readAmount(a).ambiguous)) note(ambiguousAmounts, n);
  });

  return {
    rows: rows.length,
    importable: rows.length - noName.count,
    noName, duplicates, noCode, badCodes, lostZero, ambiguousAmounts,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Catalog.importMeta as written by this module, or null for older catalogues
 * and other shapes. Meta stored before placeholders were counted apart reads
 * with no placeholder rows (they were then counted among badCodes).
 */
export function readImportMeta(json: unknown): ImportMeta | null {
  if (!isObject(json) || !isObject(json['parse']) || !isObject(json['diagnostics'])) return null;
  const d = json['diagnostics'];
  const p = json['parse'];
  if (typeof d['rows'] !== 'number' || !isObject(d['noName']) || typeof p['totalSeen'] !== 'number') return null;
  const meta = json as unknown as ImportMeta;
  return isObject(d['noCode']) ? meta : { ...meta, diagnostics: { ...meta.diagnostics, noCode: counted() } };
}

/** True when nothing in the diagnostics needs the user's attention. */
export function diagnosticsClean(d: ImportDiagnostics, parse: Pick<ParseMeta, 'truncated'>): boolean {
  return !parse.truncated && d.noName.count === 0 && d.duplicates.count === 0 && d.noCode.count === 0
    && d.badCodes.count === 0 && d.ambiguousAmounts.count === 0;
}

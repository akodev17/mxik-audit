// What an upload will turn into under a given mapping, before anything is
// audited: rows that will be dropped, duplicates, malformed codes, amounts that
// could be read two ways, and what the reader skipped. Pure; computed on the
// server and stored on Catalog.importMeta with the final mapping.
import { normalizeName } from '../core/normalize/index.js';
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
  /** Rows repeating an earlier row's name, unit and barcode. */
  duplicates: Counted & { groups: number };
  /** Non-empty code cells that are not 17 digits. */
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
    const key = `${normalizeName(name).matchKey}|${unit}|${barcode}`;
    const times = seen.get(key) ?? 0;
    if (times > 0) {
      note(duplicates, n);
      if (times === 1) duplicates.groups++;
    }
    seen.set(key, times + 1);

    const code = cell(row, mapping.mxik);
    if (code !== '') {
      const digits = code.replace(/\D/g, '');
      if (digits.length !== 17) note(badCodes, n);
      if (digits.length === 16) note(lostZero, n);
    }

    const amounts = [cell(row, mapping.price), cell(row, mapping.sales)];
    if (amounts.some((a) => a !== '' && readAmount(a).ambiguous)) note(ambiguousAmounts, n);
  });

  return {
    rows: rows.length,
    importable: rows.length - noName.count,
    noName, duplicates, badCodes, lostZero, ambiguousAmounts,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Catalog.importMeta as written by this module, or null for older catalogues and other shapes. */
export function readImportMeta(json: unknown): ImportMeta | null {
  if (!isObject(json) || !isObject(json['parse']) || !isObject(json['diagnostics'])) return null;
  const d = json['diagnostics'];
  const p = json['parse'];
  if (typeof d['rows'] !== 'number' || !isObject(d['noName']) || typeof p['totalSeen'] !== 'number') return null;
  return json as unknown as ImportMeta;
}

/** True when nothing in the diagnostics needs the user's attention. */
export function diagnosticsClean(d: ImportDiagnostics, parse: Pick<ParseMeta, 'truncated'>): boolean {
  return !parse.truncated && d.noName.count === 0 && d.duplicates.count === 0 && d.badCodes.count === 0 && d.ambiguousAmounts.count === 0;
}

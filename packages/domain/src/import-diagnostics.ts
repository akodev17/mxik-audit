// What an upload will turn into under a given mapping, before anything is
// audited: rows that will be dropped, duplicates, placeholder and malformed
// codes, amounts that could be read two ways, and what the reader skipped.
// Code cells are read like the audit reads them (readCode): no digits at all
// is no code (MISSING), digits of the wrong length a code the classifier will
// not have (NOT_FOUND). TN VED cells are read like the matcher reads them
// (core/match/tnved.ts): an odd digit count gets its lost leading zero back,
// anything else outside 4-10 digits is ignored. Pure; computed on the server and stored on
// Catalog.importMeta with the final mapping.
import { attrsKey, normalizeName } from '@tasnivo/core/normalize/index';
import { identifyingBarcode } from '@tasnivo/core/normalize/barcode';
import { readTnved } from '@tasnivo/core/match/tnved';
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
  /** TN VED cells with digits that are not an HS code of 4-10 digits: ignored when matching. */
  badTnved: Counted;
  /** TN VED cells with an odd digit count: Excel dropped the leading zero, which the import puts back. */
  tnvedZero: Counted;
};

export type ImportMeta = {
  parse: ParseMeta;
  /** For the mapping in use: the suggestion's at upload, the confirmed one after commit. */
  diagnostics: ImportDiagnostics;
  /** Where the suggested mapping came from when the upload was read. */
  remembered: 'client' | 'org' | null;
  /** Per field: remembered, guessed or unmapped in that suggestion. */
  fields?: Record<ColumnField, 'remembered' | 'guess' | 'none'>;
  /** The user changed the suggested mapping before the commit (written by diagnose). */
  edited?: boolean;
};

const counted = (): Counted => ({ count: 0, sample: [] });
const note = (c: Counted, row: number): void => {
  c.count++;
  if (c.sample.length < SAMPLE) c.sample.push(row);
};

const cell = (row: readonly string[], index: number): string => (index < 0 ? '' : (row[index] ?? '').trim());

/**
 * One finding of the diagnostics on one cell. lostZero is a badCode of 16 digits (counted in both);
 * an ambiguous amount is reported per cell, the counts take it once per row.
 */
export type ImportIssueKind = 'noName' | 'duplicate' | 'noCode' | 'badCode' | 'lostZero' | 'badTnved' | 'tnvedZero' | 'ambiguousAmount';

export type ImportIssue = {
  /** Data row, 1-based below the header (as the diagnostics' samples). */
  row: number;
  field: ColumnField;
  kind: ImportIssueKind;
  /** The cell as read (trimmed). */
  value: string;
  /** For a duplicate: the first row it repeats. */
  firstRow?: number;
};

/** Every issue of every row, in file order: the one walk both the counts and the per-row report use. */
export function eachImportIssue(rows: readonly (readonly string[])[], mapping: ColumnMap, visit: (issue: ImportIssue) => void): void {
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const n = i + 1;
    const name = cell(row, mapping.name);
    if (name === '') { visit({ row: n, field: 'name', kind: 'noName', value: '' }); return; }

    const unit = cell(row, mapping.unit).toLowerCase();
    const rawBarcode = cell(row, mapping.barcode);
    const barcode = identifyingBarcode(rawBarcode) ?? rawBarcode.replace(/\D/g, '');
    // The match key drops sizes, so they come back from the attributes: "Труба ВГП 15х2,5"
    // and "Труба ВГП 20х2,5" are two products, "Coca-Cola 1.5L" and "Coca Cola 1,5 l" one.
    const normalized = normalizeName(name);
    const key = `${normalized.matchKey}|${attrsKey(normalized.attrs)}|${unit}|${barcode}`;
    const first = seen.get(key);
    if (first !== undefined) visit({ row: n, field: 'name', kind: 'duplicate', value: name, firstRow: first });
    else seen.set(key, n);

    const code = cell(row, mapping.mxik);
    if (code !== '') {
      const digits = code.replace(/\D/g, '');
      if (digits.length === 0) visit({ row: n, field: 'mxik', kind: 'noCode', value: code });
      else if (digits.length === 16) visit({ row: n, field: 'mxik', kind: 'lostZero', value: code });
      else if (digits.length !== 17) visit({ row: n, field: 'mxik', kind: 'badCode', value: code });
    }

    const tnvedCell = cell(row, mapping.tnved);
    const tnved = readTnved(tnvedCell);
    if (tnved.status === 'bad') visit({ row: n, field: 'tnved', kind: 'badTnved', value: tnvedCell });
    if (tnved.status === 'ok' && tnved.restoredZero) visit({ row: n, field: 'tnved', kind: 'tnvedZero', value: tnvedCell });

    for (const field of ['price', 'sales'] as const) {
      const amount = cell(row, mapping[field]);
      if (amount !== '' && readAmount(amount).ambiguous) visit({ row: n, field, kind: 'ambiguousAmount', value: amount });
    }
  });
}

export function importDiagnostics(rows: readonly (readonly string[])[], mapping: ColumnMap): ImportDiagnostics {
  const noName = counted();
  const duplicates = { ...counted(), groups: 0 };
  const noCode = counted();
  const badCodes = counted();
  const lostZero = counted();
  const ambiguousAmounts = counted();
  const badTnved = counted();
  const tnvedZero = counted();
  const groups = new Set<number>();
  let lastAmbiguous = 0;

  eachImportIssue(rows, mapping, (issue) => {
    const n = issue.row;
    switch (issue.kind) {
      case 'noName': note(noName, n); break;
      case 'duplicate': note(duplicates, n); groups.add(issue.firstRow ?? n); break;
      case 'noCode': note(noCode, n); break;
      case 'lostZero': note(badCodes, n); note(lostZero, n); break;
      case 'badCode': note(badCodes, n); break;
      case 'badTnved': note(badTnved, n); break;
      case 'tnvedZero': note(tnvedZero, n); break;
      case 'ambiguousAmount':
        if (lastAmbiguous !== n) note(ambiguousAmounts, n);
        lastAmbiguous = n;
        break;
    }
  });
  duplicates.groups = groups.size;

  return {
    rows: rows.length,
    importable: rows.length - noName.count,
    noName, duplicates, noCode, badCodes, lostZero, ambiguousAmounts, badTnved, tnvedZero,
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
  // Older meta predates the placeholder and TN VED counts: none of those rows were counted then.
  return {
    ...meta,
    diagnostics: {
      ...meta.diagnostics,
      noCode: isObject(d['noCode']) ? meta.diagnostics.noCode : counted(),
      badTnved: isObject(d['badTnved']) ? meta.diagnostics.badTnved : counted(),
      tnvedZero: isObject(d['tnvedZero']) ? meta.diagnostics.tnvedZero : counted(),
    },
  };
}

/** True when nothing in the diagnostics needs the user's attention. */
export function diagnosticsClean(d: ImportDiagnostics, parse: Pick<ParseMeta, 'truncated'>): boolean {
  return !parse.truncated && d.noName.count === 0 && d.duplicates.count === 0 && d.noCode.count === 0
    && d.badCodes.count === 0 && d.ambiguousAmounts.count === 0 && d.badTnved.count === 0 && d.tnvedZero.count === 0;
}

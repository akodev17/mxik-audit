import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCode } from '../core/audit/checks.js';
import { importDiagnostics, readImportMeta } from './import-diagnostics.js';

const MAP = { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4, sales: -1 };

describe('import diagnostics', () => {
  const rows = [
    ['Guruch', '4780074540164', '06301001001000000', 'kg', '12 000', 'Olma'],
    ['', '', '06301001001000000', 'kg', '5', 'Olma'],
    ['guruch', '4780074540164', '6301001001000000', 'KG', '12,500', 'Nok'],
    ['Shakar', '', '123', 'kg', '7', 'Nok'],
    ['Shakar', '', '', 'dona', '1.5', ''],
  ];

  it('counts dropped, duplicate, malformed and ambiguous rows with examples', () => {
    const d = importDiagnostics(rows, MAP);
    assert.equal(d.rows, 5);
    assert.equal(d.importable, 4);
    assert.deepEqual(d.noName, { count: 1, sample: [2] });
    // Same name (case aside), unit and barcode: one duplicate group.
    assert.deepEqual(d.duplicates, { count: 1, sample: [3], groups: 1 });
    assert.deepEqual(d.badCodes, { count: 2, sample: [3, 4] });
    assert.deepEqual(d.lostZero, { count: 1, sample: [3] });
    assert.deepEqual(d.ambiguousAmounts, { count: 1, sample: [3] });
  });

  it('reads code cells like the audit: digitless placeholders are no code, wrong-length digits are bad codes', () => {
    const codes = [
      ['Olma', '-'], ['Nok', 'yoʻq'], ['Gilos', 'нет'], ['Uzum', 'n/a'],
      ['Shaftoli', '6301001001000000'], ['Anor', '12-34'], ['Behi', '0630 1001 001 000000'], ['Xurmo', ''],
    ];
    const d = importDiagnostics(codes, { name: 0, barcode: -1, mxik: 1, unit: -1, price: -1, sales: -1 });
    // readCode() gives null for these, so the audit reports MISSING, not NOT_FOUND.
    for (const [, cell] of codes.slice(0, 4)) assert.equal(readCode(cell), null);
    assert.ok(readCode('12-34'));
    assert.deepEqual(d.noCode, { count: 4, sample: [1, 2, 3, 4] });
    // Digits of the wrong length reach the classifier lookup and come back NOT_FOUND.
    assert.deepEqual(d.badCodes, { count: 2, sample: [5, 6] });
    assert.deepEqual(d.lostZero, { count: 1, sample: [5] });
  });

  it('follows the mapping: a different name column drops different rows', () => {
    const d = importDiagnostics(rows, { ...MAP, name: 5, unit: -1, barcode: -1 });
    assert.deepEqual(d.noName, { count: 1, sample: [5] });
    assert.deepEqual(d.duplicates, { count: 2, sample: [2, 4], groups: 2 });
  });

  it('reads stored meta back only when it has the expected shape', () => {
    assert.equal(readImportMeta(null), null);
    assert.equal(readImportMeta({ parse: {}, diagnostics: {} }), null);
    const meta = { parse: { totalSeen: 5 }, diagnostics: importDiagnostics(rows, MAP), remembered: null };
    assert.equal(readImportMeta(meta)?.diagnostics.rows, 5);
    // Meta stored before placeholders were counted apart still reads, with none of them.
    const older: Record<string, unknown> = { ...meta.diagnostics };
    delete older['noCode'];
    assert.deepEqual(readImportMeta({ ...meta, diagnostics: older })?.diagnostics.noCode, { count: 0, sample: [] });
  });
});

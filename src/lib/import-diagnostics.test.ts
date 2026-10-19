import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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
  });
});

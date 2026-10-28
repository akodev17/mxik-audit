import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseKey, scoreFile, totalScore, type RowResult } from './bench-score.js';

// A five-row answer key in the generator's layout (columns deliberately reordered).
const KEY = [
  ['Excel qatori', 'Nom', 'Topilmalar', 'Kutilgan kod', 'Kutilgan natija', 'Izoh', 'Import'],
  ['2', 'Kartoshka', '-', '', 'xatosiz', 'nom va kod mos', ''],
  ['3', 'Palov 1 porsiya', 'MISSING', '10202001006000001|10202001002000000', 'kod yoʻq', '', ''],
  ['4', 'Труба ВГП 15х2,5', 'MISMATCH, UNIT_CONFLICT', '07306001*', 'notoʻgʻri kod', '', ''],
  ['5', 'Kartoshka', '-', '', 'dublikat', '', 'dublikat'],
  ['6', '', '-', '', 'nomsiz qator', '', 'nomsiz'],
  ['7', 'Sement M400', 'MISSING', '02523002009000000', 'kod yoʻq', '', ''],
];

const result = (excelRow: number, types: string[], top1: string | null): [number, RowResult] => [excelRow, { excelRow, types, top1 }];

describe('parseKey', () => {
  it('reads the columns by header and splits finding types and codes', () => {
    const key = parseKey(KEY);
    assert.equal(key.length, 6);
    assert.deepEqual(key[0]?.expected, []);
    assert.deepEqual(key[2]?.expected, ['MISMATCH', 'UNIT_CONFLICT']);
    assert.deepEqual(key[1]?.want, ['10202001006000001', '10202001002000000']);
    assert.equal(key[3]?.importFlag, 'dublikat');
    assert.equal(key[4]?.importFlag, 'nomsiz');
  });

  it('refuses an unknown finding type and a missing column', () => {
    assert.throws(() => parseKey([KEY[0] ?? [], ['2', 'X', 'MISSNG', '', '', '', '']]), /unknown finding type MISSNG/);
    assert.throws(() => parseKey([['Excel qatori', 'Nom']]), /no "kutilgan natija" column/);
  });
});

describe('scoreFile', () => {
  const key = parseKey(KEY);
  const results = new Map([
    result(2, ['MISMATCH', 'PRIVILEGE_CODE'], '00701001001000000'), // a false MISMATCH, a privilege (not scored)
    result(3, ['MISSING'], '10202001002000000'), // right: the second alternative
    result(4, ['MISMATCH'], '07306001005015629'), // unit conflict missed; the fix is right by prefix
    result(5, [], '00701001001000000'),
    result(7, ['MISSING'], '02523002001240011'), // wrong code, right position
  ]);
  const score = scoreFile(key, results, { duplicates: 1, noName: 1 });

  it('counts precision and recall per type over audited rows only', () => {
    assert.equal(score.rows, 6);
    assert.equal(score.audited, 5);
    assert.deepEqual(score.byType.MISSING, { expected: 2, got: 2, tp: 2, precision: 100, recall: 100 });
    assert.deepEqual(score.byType.MISMATCH, { expected: 1, got: 2, tp: 1, precision: 50, recall: 100 });
    assert.deepEqual(score.byType.UNIT_CONFLICT, { expected: 1, got: 0, tp: 0, precision: null, recall: 0 });
    assert.deepEqual(score.unscored, { PRIVILEGE_CODE: 1 });
  });

  it('scores top-1 on rows without a code and the fix on wrong codes, exact and by position', () => {
    assert.deepEqual(score.top1, { n: 2, hit: 1, position: 2, pct: 50 });
    assert.deepEqual(score.fix, { n: 1, hit: 1, position: 1, pct: 100 });
  });

  it('compares import diagnostics and counts exactly right rows per label', () => {
    assert.deepEqual(score.imports, { duplicates: { expected: 1, got: 1 }, noName: { expected: 1, got: 1 } });
    assert.equal(score.rowsExact, 3);
    assert.deepEqual(score.byKind['kod yoʻq'], { n: 2, exact: 2 });
    assert.deepEqual(score.byKind['xatosiz'], { n: 1, exact: 0 });
  });

  it('throws when an audited key row has no result (rows out of line)', () => {
    assert.throws(() => scoreFile(key, new Map([result(2, [], null)]), { duplicates: 0, noName: 0 }), /row 3 .* no audit result/);
  });

  it('sums files and recomputes the rates', () => {
    const total = totalScore([score, score]);
    assert.equal(total.audited, 10);
    assert.deepEqual(total.byType.MISMATCH, { expected: 2, got: 4, tp: 2, precision: 50, recall: 100 });
    assert.deepEqual(total.top1, { n: 4, hit: 2, position: 4, pct: 50 });
    assert.deepEqual(total.byKind['xatosiz'], { n: 2, exact: 0 });
  });
});

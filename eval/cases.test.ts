import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCases } from './cases.js';
import { parseCsv, toCsv } from './csv.js';

describe('csv', () => {
  it('keeps leading zeros and quoted commas, quotes and newlines', () => {
    const rows = [['code', 'name'], ['01901001003000000', 'Guruch, "oq"\nqop']];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
  });

  it('ignores a BOM and blank lines', () => {
    assert.deepEqual(parseCsv(String.fromCharCode(0xfeff) + 'a,b\r\n\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  });
});

const HEADER = 'name,unit,barcode,correct_code,source,notes\n';

describe('parseCases', () => {
  it('loads a valid row and splits alternative codes', () => {
    const { cases, errors } = parseCases(
      `${HEADER}Kartoshka,kg,,00701001001000000|00701001002000000,real,hand-written\n`, 'golden.csv',
    );
    assert.deepEqual(errors, []);
    assert.equal(cases[0]?.name, 'Kartoshka');
    assert.deepEqual(cases[0]?.correct, ['00701001001000000', '00701001002000000']);
    assert.equal(cases[0]?.barcode, null);
    assert.equal(cases[0]?.source, 'real');
  });

  it('allows the barcode column to be absent', () => {
    const { cases, errors } = parseCases('name,unit,correct_code,source,notes\nX,,01901001003000000,synthetic,n\n', 's.csv');
    assert.deepEqual(errors, []);
    assert.equal(cases[0]?.barcode, null);
  });

  it('reports rows with a bad code or source instead of dropping them silently', () => {
    const { cases, errors } = parseCases(
      `${HEADER}A,,,123,real,x\nB,,,01901001003000000,customer,x\n`, 'golden.csv',
    );
    assert.equal(cases.length, 0);
    assert.equal(errors.length, 2);
    assert.match(errors[0] ?? '', /golden\.csv:2/);
  });

  it('reports a missing required column', () => {
    const { errors } = parseCases('name,unit\nA,kg\n', 'x.csv');
    assert.match(errors[0] ?? '', /missing column/);
  });
});

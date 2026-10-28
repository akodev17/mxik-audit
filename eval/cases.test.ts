import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { tnvedHeading } from '@tasnivo/core/match/tnved';
import { accepts, parseCases } from './cases.js';
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

  it('reads an optional TN VED column as written, absent when the file has none', () => {
    const { cases, errors } = parseCases('name,unit,barcode,tnved,correct_code,source,notes\nТруба 57,м,,7304390000,07304001*,real,n\nЛист,кг,,,07208001*,real,n\n', 'real-tnved.csv');
    assert.deepEqual(errors, []);
    assert.deepEqual(cases.map((c) => c.tnved), ['7304390000', null]);
    assert.equal(parseCases(`${HEADER}Kartoshka,kg,,00701001001000000,real,x\n`, 'g.csv').cases[0]?.tnved, null);
  });

  it('loads the TN VED set: 40+ real rows, every one with a readable code, 10+ of them vague names', () => {
    const { cases, errors } = parseCases(readFileSync('eval/real-tnved.csv', 'utf8'), 'real-tnved.csv');
    assert.deepEqual(errors, []);
    assert.ok(cases.length >= 40);
    for (const c of cases) {
      const heading = tnvedHeading(c.tnved);
      assert.ok(heading, c.id);
      // Every label lies in the row's heading: MXIK digits 2-5 are the HS heading.
      for (const label of c.correct) assert.equal(label.slice(1, 5), heading, c.id);
    }
    assert.ok(cases.filter((c) => c.notes.startsWith('vague name')).length >= 10);
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

describe('code prefixes', () => {
  it('loads a position prefix beside full codes', () => {
    const { cases, errors } = parseCases(`${HEADER}"Труба ВГП 15х2,5",тонна,,07306001*|07304001001000000,real,metal\n`, 'real-metal.csv');
    assert.deepEqual(errors, []);
    assert.deepEqual(cases[0]?.correct, ['07306001*', '07304001001000000']);
  });

  it('rejects a prefix shorter than a position', () => {
    const { errors } = parseCases(`${HEADER}X,,,0730*,real,x\n`, 'real-metal.csv');
    assert.match(errors[0] ?? '', /code prefix/);
  });

  it('accepts any code under a prefix and only the exact code otherwise', () => {
    const correct = ['07306001*', '07304001001000000'];
    assert.equal(accepts(correct, '07306001005011854'), true);
    assert.equal(accepts(correct, '07304001001000000'), true);
    assert.equal(accepts(correct, '07304001001000001'), false);
    assert.equal(accepts(correct, '02523002001095005'), false);
  });
});

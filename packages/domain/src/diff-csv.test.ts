import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffCsv, type DiffCsvLabels } from './diff-csv.js';

const labels: DiffCsvLabels = {
  columns: { kind: 'Turi', row: 'Qator', name: 'Nomi', unit: 'Birlik', code: 'Kod', beforeName: 'Oldingi nom', beforeUnit: 'Oldingi birlik', beforeCode: 'Oldingi kod', what: 'Nima', match: 'Juftlik' },
  kinds: { added: 'Qoʻshilgan', removed: 'Oʻchirilgan', changed: 'Oʻzgargan', statusChanged: 'Holat' },
  matches: { barcode: 'shtrix-kod', name: 'nom', row: 'taxminiy' },
  notes: { name: 'nom', unit: 'birlik', code: 'kod', barcode: 'shtrix', identity: 'noaniq', classifier: 'tasniflagich', nowRisky: 'xavfli', nowSafe: 'xavfsiz' },
};

describe('diffCsv', () => {
  const lists = {
    added: [{ rowIndex: 0, name: 'Kofe, 3in1', unit: 'dona', code: null }],
    removed: [{ rowIndex: 4, name: 'Choy', unit: 'dona', code: '02202001001000000' }],
    changed: [{ rowIndex: 1, name: 'Shakar', unit: 'kg', code: '019', notes: ['code' as const], match: 'row' as const, before: { name: 'Shakar', unit: 'kg', code: '018' } }],
    statusChanged: [],
  };
  const csv = diffCsv(lists, labels);
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');

  it('starts with a BOM and a header, and has one line per listed row', () => {
    assert.ok(csv.startsWith('\uFEFF'));
    assert.equal(lines.length, 4);
    assert.match(lines[0] ?? '', /^Turi,Qator,Nomi/);
  });

  it('quotes cells that hold a separator and numbers rows from 1', () => {
    assert.equal(lines[1], 'Qoʻshilgan,1,"Kofe, 3in1",dona,,,,,,');
  });

  it('writes the previous values and names an approximate pairing', () => {
    assert.equal(lines[3], 'Oʻzgargan,2,Shakar,kg,019,Shakar,kg,018,kod,taxminiy');
  });

  it('neutralises spreadsheet formulas', () => {
    const risky = diffCsv({ ...lists, added: [{ rowIndex: 0, name: '=HYPERLINK("x")', unit: null, code: null }] }, labels);
    assert.match(risky, /"'=HYPERLINK/);
  });
});

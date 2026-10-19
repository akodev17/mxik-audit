import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asciiFallback, baseName, contentDisposition, filenameFromDisposition } from './export-filename.js';

describe('download file names', () => {
  it('drops the upload extension', () => {
    assert.equal(baseName('Katalog.XLSX'), 'Katalog');
    assert.equal(baseName('prices.csv'), 'prices');
    assert.equal(baseName('.xlsx'), 'mxik-audit');
  });

  it('sends an ASCII fallback and the UTF-8 name', () => {
    const header = contentDisposition('attachment', 'Каталог «Ташкент».xlsx');
    assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    assert.equal(filenameFromDisposition(header), 'Каталог «Ташкент».xlsx');
    assert.equal(asciiFallback('Каталог.xlsx'), 'mxik-audit.xlsx');
    assert.equal(asciiFallback('Oʻzbek "nar"x.xlsx'), 'O_zbek _nar_x.xlsx');
  });

  it('reads a plain filename when there is no UTF-8 form', () => {
    assert.equal(filenameFromDisposition('attachment; filename="a.csv"'), 'a.csv');
    assert.equal(filenameFromDisposition(null), null);
  });
});

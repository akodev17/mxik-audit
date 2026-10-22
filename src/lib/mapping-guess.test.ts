import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guessMapping } from './mapping-guess.js';

describe('guessMapping name column', () => {
  it('prefers a column called "Nomi" over one that only mentions "tovar"', () => {
    const m = guessMapping(['Tovar guruhi', 'Nomi', 'MXIK kodi', 'Oʻlchov birligi', 'Narxi', 'Shtrix-kod']);
    assert.deepEqual(m, { name: 1, mxik: 2, unit: 3, price: 4, barcode: 5, sales: -1 });
  });

  it('prefers "Наименование" over "Группа товара"', () => {
    assert.equal(guessMapping(['Группа товара', 'Наименование']).name, 1);
    assert.equal(guessMapping(['Товар категория', 'Название', 'ИКПУ']).name, 1);
    assert.equal(guessMapping(['Tovar turi', 'Product name']).name, 1);
  });

  it('prefers a whole-word name over a plain hint', () => {
    assert.equal(guessMapping(['Tovar guruhi', 'Mahsulot nomi']).name, 1);
    assert.equal(guessMapping(['Tovar turi', 'Tovar nomi:']).name, 1);
  });

  it('still takes a lone "Tovar" column as the name', () => {
    assert.equal(guessMapping(['Tovar', 'MXIK kodi', 'Narxi']).name, 0);
    assert.equal(guessMapping(['MXIK kodi', 'Tovar']).name, 1);
  });

  it('falls back to the first free column when no header names the product', () => {
    assert.equal(guessMapping(['MXIK kodi', 'Kolonka A', 'Narxi']).name, 1);
    assert.equal(guessMapping(['A', 'B']).name, 0);
    assert.equal(guessMapping([]).name, 0);
  });

  it('never takes a code column for the name', () => {
    const m = guessMapping(['Mahsulot MXIK kodi', 'Mahsulot shtrix kodi', 'Mahsulot']);
    assert.deepEqual([m.mxik, m.barcode, m.name], [0, 1, 2]);
  });
});

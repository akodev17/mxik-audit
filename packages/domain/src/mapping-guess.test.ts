import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { guessMapping } from './mapping-guess.js';

describe('guessMapping name column', () => {
  it('prefers a column called "Nomi" over one that only mentions "tovar"', () => {
    const m = guessMapping(['Tovar guruhi', 'Nomi', 'MXIK kodi', 'Oʻlchov birligi', 'Narxi', 'Shtrix-kod']);
    assert.deepEqual(m, { name: 1, mxik: 2, unit: 3, price: 4, barcode: 5, sales: -1, tnved: -1 });
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

  it('reads a 1C export: "Номенклатура" is the name, "Код" is not, "Ед." is the unit', () => {
    const m = guessMapping(['Код', 'Номенклатура', 'Штрихкод', 'ИКПУ', 'Ед.', 'Цена розн.']);
    assert.deepEqual(m, { name: 1, barcode: 2, mxik: 3, unit: 4, price: 5, sales: -1, tnved: -1 });
    assert.equal(guessMapping(['Kod', 'Nomenklatura', 'MXIK']).name, 1);
    assert.equal(guessMapping(['Артикул', 'Наименование номенклатуры']).name, 1);
  });

  it('skips identifier columns in the fallback, but still returns a column', () => {
    assert.equal(guessMapping(['Код', 'Kolonka', 'ИКПУ']).name, 1);
    assert.equal(guessMapping(['№', 'Артикул', 'Описание']).name, 2);
    assert.equal(guessMapping(['Код', 'ИКПУ']).name, 0);
  });

  it('B2: reads an Uzbek-Cyrillic list: "Т/р" is the row number, the Latin "МХИК номи" is the name', () => {
    const m = guessMapping(['Т/р', 'МХИК коди', 'МХИК номи (Лотин алифбосида)', 'МХИК номи (Ўзб)', 'МХИК номи (Рус)']);
    assert.deepEqual([m.name, m.mxik], [2, 1]);
    assert.equal(guessMapping(['Т/р', 'МХИК номи (Ўзб)', 'МХИК номи (Лотин алифбосида)']).name, 2, 'the Latin one wins anywhere');
    assert.equal(guessMapping(['№', 'Маҳсулот номи', 'Нархи']).name, 1);
    for (const h of ['Т/р', 'т/р', 'П/п', '№ п/п', 't/r', 'TR']) assert.equal(guessMapping([h, 'Kolonka']).name, 1, h);
  });
});

describe('guessMapping TIF TN (TN VED) column', () => {
  it('finds it under its Uzbek, Russian and English names', () => {
    for (const header of ['TIF TN kodi', 'TIF TN', 'Код ТН ВЭД', 'ТН ВЭД', 'ТНВЭД', 'TN VED', 'tnved', 'HS code', 'код тн вэд', 'Код по ТН-ВЭД']) {
      assert.equal(guessMapping(['Nomi', header, 'MXIK kodi']).tnved, 1, header);
    }
  });

  it('takes the spelled-out name before the name column can claim its "tovar nomenklaturasi"', () => {
    const m = guessMapping(['Tovar nomi', 'Tashqi iqtisodiy faoliyat tovar nomenklaturasi kodi', 'MXIK']);
    assert.deepEqual([m.name, m.tnved, m.mxik], [0, 1, 2]);
    const ru = guessMapping(['Код товарной номенклатуры внешнеэкономической деятельности', 'Наименование']);
    assert.deepEqual([ru.tnved, ru.name], [0, 1]);
  });

  it('never takes the MXIK or barcode column, and stays unmapped when the file has none', () => {
    const m = guessMapping(['Код', 'Номенклатура', 'Штрихкод', 'ИКПУ', 'Код ТН ВЭД', 'Ед.']);
    assert.deepEqual(m, { name: 1, barcode: 2, mxik: 3, tnved: 4, unit: 5, price: -1, sales: -1 });
    assert.equal(guessMapping(['Nomi', 'MXIK kodi', 'Birlik']).tnved, -1);
  });
});

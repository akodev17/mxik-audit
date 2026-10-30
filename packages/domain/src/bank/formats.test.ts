// Layout recognition, the mapping guess for an unknown bank, header signatures, two-row headers.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BUILT_IN_FORMATS, detectFormat, guessMapping, headerSignature, mappingProblem, toColumnMap } from './formats/index.js';
import { joinHeaderRows, locateTable, readTitle } from './sheet.js';
import { bankHeaderKey, headerScore, resolveColumns } from './vocabulary.js';

describe('built-in layouts', () => {
  it('there are at least three, none verified (no real statement in the repository)', () => {
    assert.ok(BUILT_IN_FORMATS.length >= 3);
    for (const f of BUILT_IN_FORMATS) {
      assert.equal(f.verified, false, f.id);
      assert.ok(f.required.includes('date'), f.id);
      // The 30 Oct layouts cite the bank research, summarised with its URLs in fixtures/SOURCES.md.
      assert.match(f.source, /integration-research\.md|fixtures\/SOURCES\.md/);
    }
  });

  it('recognise RU, UZ Latin and the single-amount layouts by their words', () => {
    assert.equal(detectFormat(['Дата', '№ док', 'Корреспондент', 'ИНН', 'Счёт', 'МФО', 'Дебет', 'Кредит', 'Назначение платежа'])?.format.id, 'generic_ru_debit_credit');
    assert.equal(detectFormat(['Sana', 'Hujjat raqami', 'Kontragent', 'STIR', 'Hisob raqami', 'MFO', 'Debet', 'Kredit', "To'lov maqsadi"])?.format.id, 'generic_uz_debit_credit');
    const flag = detectFormat(['Дата', 'Номер документа', 'Наименование плательщика/получателя', 'ИНН', 'Расчётный счёт', 'МФО', 'Сумма', 'Дебет/Кредит', 'Назначение платежа']);
    assert.equal(flag?.format.id, 'generic_amount_direction');
    assert.equal(flag?.conventions.direction, 'flag');
    assert.equal(flag?.columnMap.direction, 7, '"Дебет/Кредит" is the flag, not the credit column');
    const signed = detectFormat(['Дата', 'Контрагент', 'Сумма', 'Назначение']);
    assert.equal(signed?.conventions.direction, 'signed');
  });

  it('an unknown layout is not recognised; the guess still finds what it can', () => {
    const headers = ['Kun', 'Hamkor', 'Pul', 'Izoh'];
    assert.equal(detectFormat(headers), null);
    const guess = guessMapping(headers);
    assert.equal(guess.columnMap.date, -1);
    assert.equal(guess.columnMap.purpose, 3, '"Izoh" is a purpose word');
    assert.equal(mappingProblem(guess.columnMap, guess.conventions), 'date');
  });

  it('"Сумма по дебету" is the debit column, never the amount', () => {
    const resolved = resolveColumns(['Дата', 'Сумма по дебету', 'Сумма по кредиту']);
    assert.deepEqual([resolved.debit, resolved.credit, resolved.amount], [1, 2, undefined]);
  });

  it('mapping problems name what is missing', () => {
    const base = { dateOrder: 'dmy', decimal: 'auto', negativeIs: 'debit', currency: 'UZS' } as const;
    assert.equal(mappingProblem(toColumnMap({ date: 0, debit: 1 }), { ...base, direction: 'columns' }), 'amount');
    assert.equal(mappingProblem(toColumnMap({ date: 0, amount: 1 }), { ...base, direction: 'flag' }), 'direction');
    assert.equal(mappingProblem(toColumnMap({ date: 0, amount: 1 }), { ...base, direction: 'signed' }), null);
  });
});

describe('header signature (the key of a saved layout)', () => {
  it('ignores case, ё/е, apostrophes and spacing; differs when a column differs', () => {
    assert.equal(headerSignature(['Дата', 'Счёт', "To'lov  maqsadi"]), headerSignature(['дата', 'Счет', 'Tolov maqsadi']));
    assert.notEqual(headerSignature(['Дата', 'Сумма']), headerSignature(['Дата', 'Сумма', 'Валюта']));
    assert.equal(headerSignature(['Дата', 'Ustun 2', 'Сумма', 'Ustun 4']), 'дата||сумма', 'placeholder names of empty headers are blank, trailing ones dropped');
    assert.equal(bankHeaderKey('  № Док.: '), '№ док');
  });
});

describe('locating the table', () => {
  it('the header is found under a long title block by its words', () => {
    const grid = [
      ['Bank'], ['Выписка за 01.10.2026'], ['Клиент: ООО Тест'], ['ИНН 301234567'], ['Счет 20208000900123456001'], [],
      ['Дата', 'Контрагент', 'Дебет', 'Кредит', 'Назначение'],
      ['01.10.2026', 'A', '10', '', 'x'],
    ];
    const sheet = locateTable(grid);
    assert.equal(sheet.headerRow, 7);
    assert.equal(sheet.body.length, 1);
    assert.deepEqual(sheet.titleLines.slice(0, 2), ['Bank', 'Выписка за 01.10.2026']);
    const title = readTitle(sheet.titleRows);
    assert.deepEqual([title.account, title.ownInn, title.periodFrom], ['20208000900123456001', '301234567', '2026-10-01']);
  });

  it('a second header row carries the top label over merged cells', () => {
    assert.deepEqual(
      joinHeaderRows(['Дата', 'Корреспондент', '', '', 'Сумма', '', 'Назначение'], ['', 'Наименование', 'ИНН', 'Счет', 'Дебет', 'Кредит', '']),
      ['Дата', 'Корреспондент Наименование', 'Корреспондент ИНН', 'Корреспондент Счет', 'Сумма Дебет', 'Сумма Кредит', 'Назначение'],
    );
  });

  it('a data row is never taken for a second header row', () => {
    const sheet = locateTable([['Дата', 'Контрагент', 'Дебет', 'Кредит'], ['01.10.2026', 'A', '10', '']]);
    assert.equal(sheet.twoRowHeader, false);
    assert.equal(sheet.body.length, 1);
  });

  it('headerScore counts distinct roles', () => {
    assert.equal(headerScore(['Дата', 'Дата', 'Сумма']), 2);
    assert.equal(headerScore(['Выписка по счету']), 0);
  });
});

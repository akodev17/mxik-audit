import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ru, uz } from './firm.js';

describe('firm dictionary plurals and labels', () => {
  it('agrees the Russian verb with the row count in the catalogue delete confirmation', () => {
    const rows = ru.firmX.catalogs.deleteRows;
    assert.equal(rows('1', 1), 'Будет удалена 1 строка');
    assert.equal(rows('4', 4), 'Будут удалены 4 строки');
    assert.equal(rows('5', 5), 'Будет удалено 5 строк');
    assert.equal(rows('21', 21), 'Будет удалена 21 строка');
  });

  it('keeps the stale tab lower-case inside its parentheses', () => {
    assert.equal(ru.firmX.clients.staleTab(30), 'старше 30 дней');
    assert.equal(uz.firmX.clients.staleTab(30), '30 kundan eski');
  });

  it('labels both numbers of a problem type', () => {
    assert.equal(uz.firmX.home.typeFindings('32', 32), '32 ta topilma');
    assert.equal(ru.firmX.home.typeFindings('2', 2), '2 замечания');
  });
});

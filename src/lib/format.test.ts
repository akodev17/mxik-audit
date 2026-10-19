import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtDate, fmtDateTime, isoDay } from './format';
import { pluralRu } from './plural';

describe('format', () => {
  it('uses Tashkent time for dates (UTC+5)', () => {
    // 19:30 UTC on 19 Oct is already 20 Oct in Tashkent.
    assert.equal(fmtDate('uz', '2026-10-19T19:30:00Z'), '20.10.2026');
    assert.equal(fmtDate('ru', '2026-10-19T19:30:00Z'), '20.10.2026');
    assert.equal(isoDay('2026-10-19T19:30:00Z'), '2026-10-20');
    assert.equal(fmtDateTime('ru', '2026-10-19T09:05:00Z'), '19.10.2026 14:05');
  });
});

describe('pluralRu', () => {
  it('picks the Russian form', () => {
    assert.equal(pluralRu(1, 'строка', 'строки', 'строк'), 'строка');
    assert.equal(pluralRu(3, 'строка', 'строки', 'строк'), 'строки');
    assert.equal(pluralRu(11, 'строка', 'строки', 'строк'), 'строк');
    assert.equal(pluralRu(83, 'строка', 'строки', 'строк'), 'строки');
    assert.equal(pluralRu(25, 'строка', 'строки', 'строк'), 'строк');
  });
});

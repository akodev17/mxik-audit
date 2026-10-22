import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fmtDate, fmtDateTime, fmtNumber, fmtPercent, isoDay } from './format';
import { pluralRu } from './plural';

const NBSP = ' ';

describe('format', () => {
  it('uses Tashkent time for dates (UTC+5)', () => {
    // 19:30 UTC on 19 Oct is already 20 Oct in Tashkent.
    assert.equal(fmtDate('uz', '2026-10-19T19:30:00Z'), '20.10.2026');
    assert.equal(fmtDate('ru', '2026-10-19T19:30:00Z'), '20.10.2026');
    assert.equal(isoDay('2026-10-19T19:30:00Z'), '2026-10-20');
    assert.equal(fmtDateTime('ru', '2026-10-19T09:05:00Z'), '19.10.2026 14:05');
    // Midnight in Tashkent is 00, not 24.
    assert.equal(fmtDateTime('uz', '2026-10-19T19:00:00Z'), '20.10.2026 00:00');
  });

  // Literal strings, not Intl output: the same text must come out of Node and every browser,
  // or a server-rendered number hydrates differently (Chromium has no uz-UZ grouping data).
  it('groups thousands with a no-break space and uses a decimal comma in both languages', () => {
    assert.equal(fmtNumber('uz', 1234567), `1${NBSP}234${NBSP}567`);
    assert.equal(fmtNumber('ru', 1234567), `1${NBSP}234${NBSP}567`);
    assert.equal(fmtNumber('uz', 3000), `3${NBSP}000`);
    assert.equal(fmtNumber('uz', 999), '999');
    assert.equal(fmtNumber('uz', -2500), `-2${NBSP}500`);
    assert.equal(fmtNumber('uz', 1234.567), `1${NBSP}235`);
    assert.equal(fmtNumber('uz', 0.78, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), '0,78');
    assert.equal(fmtNumber('ru', 12345.5, { maximumFractionDigits: 1 }), `12${NBSP}345,5`);
  });

  it('writes percentages the way each language does', () => {
    assert.equal(fmtPercent('uz', 0.42), '42%');
    assert.equal(fmtPercent('ru', 0.42), `42${NBSP}%`);
    assert.equal(fmtPercent('uz', 1, { minimumFractionDigits: 1 }), '100,0%');
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

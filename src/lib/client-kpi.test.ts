import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openRowsHint, reviewedShare } from './client-kpi.js';
import { fmtPercent } from './format.js';
import { ru, uz } from './i18n-parts/firm.js';

describe('KPI tile hints', () => {
  it('names findings only when some rows carry several', () => {
    assert.equal(openRowsHint('uz', uz.firmX.progress, 85, 88), '88 ta topilma: ayrim qatorlarda bir nechta');
    assert.equal(openRowsHint('ru', ru.firmX.progress, 85, 88), '88 замечаний: в некоторых строках по несколько');
    assert.equal(openRowsHint('uz', uz.firmX.progress, 85, 85), uz.firmX.progress.inQueue);
    assert.equal(openRowsHint('uz', uz.firmX.progress, 0, 0), undefined);
  });

  it('gives the reviewed share instead of repeating done / total', () => {
    assert.equal(reviewedShare('uz', uz.firmX.progress, { done: 2, total: 87 }), '2% bajarildi');
    assert.equal(reviewedShare('ru', ru.firmX.progress, { done: 2, total: 87 }), `Выполнено ${fmtPercent('ru', 0.02)}`);
  });

  it('never rounds an unfinished review up to 100%', () => {
    assert.equal(reviewedShare('uz', uz.firmX.progress, { done: 999, total: 1000 }), '99% bajarildi');
    assert.equal(reviewedShare('uz', uz.firmX.progress, { done: 5, total: 5 }), '100% bajarildi');
  });
});

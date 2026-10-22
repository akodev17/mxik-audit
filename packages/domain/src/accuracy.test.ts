import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvCell, keyText, labelWords, reasonText } from './accuracy.js';
import { dict } from './i18n.js';
import { appDict } from './i18n-app.js';

describe('accuracy metrics', () => {
  it('words each label exactly as the app shows it, in both languages', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const t = dict(locale);
      const ta = appDict(locale);
      assert.deepEqual(labelWords(locale), {
        barcode: ta.matchX.label.barcode,
        dictionary: ta.matchX.label.dictionary,
        sure: t.confidenceSure,
        likely: t.confidenceLikely,
        check: t.confidenceCheck,
      });
      for (const word of Object.values(labelWords(locale))) assert.doesNotMatch(word, /^(Aniq|Ehtimoliy)$/);
    }
  });

  it('translates label keys and "unknown" per viewer, and leaves stages, orgs and weeks as stored', () => {
    assert.equal(keyText('label', 'sure', 'ru'), dict('ru').confidenceSure);
    assert.equal(keyText('label', 'check', 'uz'), dict('uz').confidenceCheck);
    assert.equal(keyText('label', 'barcode', 'ru'), appDict('ru').matchX.label.barcode);
    assert.equal(keyText('label', 'unknown', 'ru'), 'Неизвестно');
    assert.equal(keyText('stage', 'unknown', 'uz'), 'Nomaʼlum');
    assert.equal(keyText('stage', 'lexical', 'ru'), 'lexical');
    assert.equal(keyText('org', 'unknown', 'ru'), 'unknown');
    assert.equal(keyText('week', '2026-10-12', 'uz'), '2026-10-12');
    assert.equal(keyText('label', 'toString', 'uz'), 'toString');
  });

  it('words a wrong-suggestion reason in the viewer language', () => {
    assert.equal(reasonText('unit', 'ru'), appDict('ru').wrong.reasons.unit);
    assert.equal(reasonText('other_category', 'uz'), appDict('uz').wrong.reasons.other_category);
    assert.equal(reasonText('constructor', 'uz'), 'constructor');
  });

  it('neutralises formulas in CSV cells and quotes separators', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvCell('+998 90'), "'+998 90");
    assert.equal(csvCell('-cmd'), "'-cmd");
    assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(csvCell('\tx'), "'\tx");
    assert.equal(csvCell('\rx'), `"'\rx"`);
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell(-5), '-5');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell('Guruch'), 'Guruch');
  });
});

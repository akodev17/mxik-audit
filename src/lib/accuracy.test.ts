import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvCell, LABEL_WORDING } from './accuracy.js';
import { dict } from './i18n.js';
import { appDict } from './i18n-app.js';

describe('accuracy metrics', () => {
  it('words each label exactly as the app shows it', () => {
    const t = dict('uz');
    const ta = appDict('uz');
    assert.deepEqual(LABEL_WORDING, {
      barcode: ta.matchX.label.barcode,
      dictionary: ta.matchX.label.dictionary,
      sure: t.confidenceSure,
      likely: t.confidenceLikely,
      check: t.confidenceCheck,
    });
    for (const word of Object.values(LABEL_WORDING)) assert.doesNotMatch(word, /^(Aniq|Ehtimoliy)$/);
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

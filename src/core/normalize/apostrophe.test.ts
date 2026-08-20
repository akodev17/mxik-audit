import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MODIFIER_APOSTROPHE, TURNED_COMMA, hasApostrophe, normalizeApostrophes, stripApostrophes } from './apostrophe.js';

// The seven marks the Gate 0 census found in the official export, by frequency.
const VARIANTS = ['’', "'", '`', '‘', '´', 'ʻ', 'ʼ'];

describe('normalizeApostrophes', () => {
  it('maps every observed variant after o/g to the turned comma', () => {
    for (const mark of VARIANTS) {
      assert.equal(normalizeApostrophes(`go${mark}sht`), `go${TURNED_COMMA}sht`, `failed for U+${mark.codePointAt(0)?.toString(16)}`);
      assert.equal(normalizeApostrophes(`bog${mark}`), `bog${TURNED_COMMA}`);
    }
  });

  it('uses the modifier apostrophe elsewhere (tutuq belgisi)', () => {
    for (const mark of VARIANTS) {
      assert.equal(normalizeApostrophes(`ma${mark}no`), `ma${MODIFIER_APOSTROPHE}no`);
    }
  });

  it('handles uppercase O and G', () => {
    assert.equal(normalizeApostrophes("GO'SHT"), `GO${TURNED_COMMA}SHT`);
  });

  it('handles a leading mark with no preceding character', () => {
    assert.equal(normalizeApostrophes("'abc"), `${MODIFIER_APOSTROPHE}abc`);
  });

  it('is idempotent', () => {
    const once = normalizeApostrophes("go'sht ma'no");
    assert.equal(normalizeApostrophes(once), once);
  });

  it('leaves strings without marks untouched', () => {
    assert.equal(normalizeApostrophes('shakar'), 'shakar');
    assert.equal(normalizeApostrophes(''), '');
  });
});

describe('stripApostrophes', () => {
  it('collapses oʻ / o\' / o to the same form', () => {
    const forms = ['goʻsht', "go'sht", 'go’sht', 'gosht'];
    const stripped = forms.map(stripApostrophes);
    assert.deepEqual(new Set(stripped), new Set(['gosht']));
  });

  it('removes a mark at either boundary', () => {
    assert.equal(stripApostrophes("'x'"), 'x');
  });
});

describe('hasApostrophe', () => {
  it('detects each variant and is not sticky across calls', () => {
    for (const mark of VARIANTS) {
      assert.equal(hasApostrophe(`a${mark}b`), true);
      // A stateful global regex would return false on the second identical call.
      assert.equal(hasApostrophe(`a${mark}b`), true);
    }
    assert.equal(hasApostrophe('plain'), false);
  });
});

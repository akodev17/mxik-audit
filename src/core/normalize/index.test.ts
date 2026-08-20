import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { indexKeys, matchKeyOf, normalizeBarcode, normalizeName } from './index.js';

describe('matchKeyOf', () => {
  it('collapses every apostrophe spelling of the same word', () => {
    const keys = ["no'xat", 'noʻxat', 'no’xat', 'noxat', 'нўхат'].map(matchKeyOf);
    assert.equal(new Set(keys).size, 1, `got ${JSON.stringify(keys)}`);
    assert.equal(keys[0], 'noxat');
  });

  it('bridges the two scripts', () => {
    assert.equal(matchKeyOf('Сут'), matchKeyOf('Sut'));
    assert.equal(matchKeyOf('Шакар'), matchKeyOf('Shakar'));
  });

  it('is case, punctuation and whitespace insensitive', () => {
    assert.equal(matchKeyOf('GO’ShT,  VA   go’sht.'), 'gosht va gosht');
  });

  it('repairs a stranded Cyrillic homoglyph before folding', () => {
    assert.equal(matchKeyOf('pэt paket'), matchKeyOf('pet paket'));
  });

  it('folds diacritics from brand names', () => {
    assert.equal(matchKeyOf('Şeker'), matchKeyOf('Seker'));
  });

  it('is idempotent', () => {
    const once = matchKeyOf('GO’ShT 1,5 L');
    assert.equal(matchKeyOf(once), once);
  });

  it('returns empty for input with no letters or digits', () => {
    assert.equal(matchKeyOf('  ... '), '');
  });
});

describe('normalizeName', () => {
  it('separates the core name from packaging attributes', () => {
    const n = normalizeName('Coca-Cola 1.5L x 6 шт');
    assert.equal(n.core, 'Coca-Cola');
    assert.equal(n.matchKey, 'coca cola');
    assert.equal(n.attrs.volumeMl, 1500);
    assert.equal(n.attrs.packCount, 6);
  });

  it('produces a display form with the correct modifier letter', () => {
    const n = normalizeName("go'sht");
    assert.equal(n.display, 'goʻsht');
  });

  it('fills both script renderings', () => {
    const n = normalizeName('Сут');
    assert.equal(n.latin, 'Sut');
    assert.equal(n.script, 'cyrillic');
    assert.equal(n.cyrillic, 'Сут');
  });

  it('makes word order irrelevant in sortedKey but not matchKey', () => {
    const a = normalizeName('Coca Cola');
    const b = normalizeName('Cola Coca');
    assert.equal(a.sortedKey, b.sortedKey);
    assert.notEqual(a.matchKey, b.matchKey);
  });

  it('handles a real messy mixed-script catalogue row', () => {
    const n = normalizeName('Muzlatilgan suyaksiz go’sht (mol go’shti): Родной дом, PET paket 150 g');
    assert.equal(n.attrs.weightG, 150);
    assert.equal(n.script, 'mixed');
    // The Cyrillic brand must survive into the Latin rendering, transliterated.
    assert.ok(n.latin.includes('Rodnoy dom'), n.latin);
  });

  it('survives empty input without throwing', () => {
    const n = normalizeName('');
    assert.equal(n.matchKey, '');
    assert.deepEqual(n.tokens, []);
  });

  it('keeps the raw input verbatim', () => {
    const raw = "  GO'ShT  ";
    assert.equal(normalizeName(raw).raw, raw);
  });
});

describe('indexKeys', () => {
  it('includes both readings of ц so either spelling retrieves', () => {
    const keys = indexKeys('Portlandtsement');
    assert.ok(keys.includes('portlandtsement'));
    assert.ok(keys.includes('portlandsement'));
  });

  it('never contains an empty key', () => {
    assert.ok(!indexKeys('...').includes(''));
    assert.deepEqual(indexKeys(''), []);
  });

  it('de-duplicates', () => {
    const keys = indexKeys('sut');
    assert.equal(keys.length, new Set(keys).size);
  });
});

describe('normalizeBarcode', () => {
  it('pads valid GTIN lengths to 14', () => {
    assert.equal(normalizeBarcode('4780074540164'), '04780074540164');
    assert.equal(normalizeBarcode('12345678'), '00000012345678');
    assert.equal(normalizeBarcode('123456789012'), '00123456789012');
    assert.equal(normalizeBarcode('12345678901234'), '12345678901234');
  });

  it('rejects the invalid lengths Gate 0 found in the catalogue', () => {
    // 39 catalogue barcodes are 10-11 digits; they must not yield a 1.0 match.
    assert.equal(normalizeBarcode('1234567890'), null);
    assert.equal(normalizeBarcode('12345678901'), null);
  });

  it('strips separators before judging length', () => {
    assert.equal(normalizeBarcode('4780-0745-40164'), '04780074540164');
  });

  it('handles null, undefined and empty', () => {
    assert.equal(normalizeBarcode(null), null);
    assert.equal(normalizeBarcode(undefined), null);
    assert.equal(normalizeBarcode(''), null);
    assert.equal(normalizeBarcode('abc'), null);
  });
});

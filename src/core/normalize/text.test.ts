import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collapseRepeats, foldCase, foldDiacritics, repairHomoglyphs, squeezeWhitespace, stripPunctuation, tokenize } from './text.js';

describe('collapseRepeats', () => {
  it('collapses runs of three or more', () => {
    assert.equal(collapseRepeats('sooooot'), 'sot');
    assert.equal(collapseRepeats('aaa'), 'a');
  });

  it('leaves legitimate doubles alone (Russian "ss", "nn")', () => {
    assert.equal(collapseRepeats('massa'), 'massa');
    assert.equal(collapseRepeats('tonna'), 'tonna');
  });

  it('does not collapse repeated digits, which carry meaning', () => {
    assert.equal(collapseRepeats('1000'), '1000');
  });
});

describe('stripPunctuation / squeezeWhitespace / tokenize', () => {
  it('turns separators into token boundaries', () => {
    assert.equal(squeezeWhitespace(stripPunctuation('Sut: Promeat, 500 gr.')), 'Sut Promeat 500 gr');
  });

  it('treats hyphens as separators so Coca-Cola tokenizes', () => {
    assert.deepEqual(tokenize('Coca-Cola'), ['Coca', 'Cola']);
  });

  it('drops empty tokens and trims', () => {
    assert.deepEqual(tokenize('   ///  a  ,, b  '), ['a', 'b']);
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize('...'), []);
  });

  it('squeezes tabs and newlines, which the export embeds in headers', () => {
    assert.equal(squeezeWhitespace('a\t\tb\n c'), 'a b c');
  });
});

describe('foldCase', () => {
  it('lowercases without locale surprises', () => {
    assert.equal(foldCase('GO’ShT'), 'go’sht');
    assert.equal(foldCase('IQTISOD'), 'iqtisod');
  });
});

describe('repairHomoglyphs', () => {
  it('fixes a Cyrillic letter stranded in a Latin word', () => {
    // Straight from the export: "dona (pэt butilka)".
    assert.equal(repairHomoglyphs('pэt'), 'pet');
    assert.equal(repairHomoglyphs('aэrozol'), 'aerozol');
  });

  it('leaves genuine Cyrillic words alone', () => {
    assert.equal(repairHomoglyphs('Родной дом'), 'Родной дом');
    assert.equal(repairHomoglyphs('Сут'), 'Сут');
  });

  it('leaves pure Latin untouched', () => {
    assert.equal(repairHomoglyphs('Coca Cola'), 'Coca Cola');
  });

  it('does not fire when Cyrillic outweighs Latin in the word', () => {
    assert.equal(repairHomoglyphs('Мираторгa'), 'Мираторгa');
  });

  it('preserves case of the repaired character', () => {
    assert.equal(repairHomoglyphs('Эxport'), 'Export');
  });
});

describe('foldDiacritics', () => {
  it('folds Turkish letters the catalogue keeps in brand names', () => {
    assert.equal(foldDiacritics('şeker'), 'seker');
    assert.equal(foldDiacritics('ılık'), 'ilik');
    assert.equal(foldDiacritics('çağ'), 'cag');
  });

  it('folds common European diacritics', () => {
    assert.equal(foldDiacritics('Müller'), 'Muller');
    assert.equal(foldDiacritics('café'), 'cafe');
  });

  it('expands ligatures and sharp s', () => {
    assert.equal(foldDiacritics('straße'), 'strasse');
    assert.equal(foldDiacritics('æon'), 'aeon');
  });

  it('leaves the Uzbek turned comma intact (it is a letter, not an accent)', () => {
    assert.equal(foldDiacritics('goʻsht'), 'goʻsht');
  });

  it('is idempotent', () => {
    const once = foldDiacritics('şığ');
    assert.equal(foldDiacritics(once), once);
  });
});

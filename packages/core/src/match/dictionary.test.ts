import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dictionaryKeys, nameKeyOf } from './dictionary.js';

const key = (rawName: string, unit: string | null = null): string | null => dictionaryKeys({ rawName, unit }).name;

describe('dictionary name key (F1: sizes, grades and models are part of the product)', () => {
  // Each pair used to share one entry, so auto-accept spread one code to every variant.
  const variants: [string, string][] = [
    ['Sut 3.2% 1l', 'Sut 2.5% 1l'],
    ['Шампунь 250 мл', 'Шампунь 500мл'],
    ['Труба ВГП 15х2,5', 'Труба ВГП 20х2,5'],
    ['Cement M400', 'Cement M500'],
    ['Samsung Galaxy A515F', 'Samsung Galaxy G991B'],
    ['Coca-Cola 0.5L', 'Coca-Cola 1.5L'],
  ];
  for (const [a, b] of variants) {
    it(`"${a}" and "${b}" are two entries`, () => {
      assert.ok(key(a, 'dona'));
      assert.notEqual(key(a, 'dona'), key(b, 'dona'));
    });
  }

  // The same product written differently still finds the one entry.
  const duplicates: [string, string][] = [
    ['Coca-Cola 1.5L', 'Coca Cola 1,5 l'],
    ['Sut 3.2% 1l', 'sut 3,2 % 1 L'],
    ['Шампунь 250 мл', 'шампунь 250мл'],
    ['Труба ВГП 15х2,5', 'труба вгп 15x2.5'],
    ['Cement M400', 'cement m400'],
    ['Guruch lazer', 'lazer guruch'],
  ];
  for (const [a, b] of duplicates) {
    it(`"${a}" and "${b}" are one entry`, () => {
      assert.equal(key(a, 'kg'), key(b, 'kg'));
    });
  }

  it('is sortedKey|attrs|unit, with an empty middle for a name without sizes', () => {
    const k = dictionaryKeys({ rawName: 'Guruch lazer', unit: 'kg' });
    assert.equal(k.attrs, '');
    assert.equal(k.name, `guruch lazer||${k.unit}`);
    assert.equal(dictionaryKeys({ rawName: 'Sut 1l', unit: 'kg' }).attrs, 'v1000');
    assert.equal(nameKeyOf('', 'v1', 'x'), null);
  });

  it('keeps the unit apart, and a name that folds to nothing has no key', () => {
    assert.notEqual(key('Guruch', 'kg'), key('Guruch', 'dona'));
    assert.equal(key('!!!', 'kg'), null);
  });
});

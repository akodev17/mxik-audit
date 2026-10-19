import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { containerLabel, packagingLabel, unitLabel } from './unit-label.js';

describe('unit labels', () => {
  it('keep the official Latin name in Uzbek', () => {
    assert.equal(unitLabel('uz', 'dona'), 'dona');
    assert.equal(unitLabel('uz', 'шт'), 'dona');
    assert.equal(containerLabel('uz', 'banka'), 'banka');
    assert.equal(packagingLabel('uz', '50 g'), '50 g');
  });

  it('use Russian abbreviations in Russian', () => {
    assert.equal(unitLabel('ru', 'dona'), 'шт');
    assert.equal(unitLabel('ru', 'litr'), 'л');
    assert.equal(unitLabel('ru', 'kilogramm'), 'кг');
    assert.equal(unitLabel('ru', 'dona (butilka)'), 'шт (бутылка)');
  });

  it('translate packaging read from the name and the classifier container', () => {
    assert.equal(packagingLabel('ru', '50 g'), '50 г');
    assert.equal(packagingLabel('ru', '1,5 L'), '1,5 л');
    assert.equal(packagingLabel('ru', '12 dona'), '12 шт');
    assert.equal(packagingLabel('ru', '500 ml'), '500 мл');
    assert.equal(containerLabel('ru', 'banka'), 'банка');
  });

  it('fall back to Cyrillic rather than leave a Latin word in Russian text', () => {
    assert.equal(/[a-z]/i.test(unitLabel('ru', 'flakon')), false);
    assert.equal(/[a-z]/i.test(containerLabel('ru', 'idish')), false);
  });
});

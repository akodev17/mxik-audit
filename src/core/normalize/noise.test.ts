import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attrsKey, stripNoise } from './noise.js';

describe('stripNoise', () => {
  it('handles the brief\'s canonical example', () => {
    const r = stripNoise('Coca-Cola 1.5L x 6 шт');
    assert.equal(r.core, 'Coca-Cola');
    assert.equal(r.attrs.volumeMl, 1500);
    assert.equal(r.attrs.packCount, 6);
  });

  it('normalizes volume units to millilitres', () => {
    assert.equal(stripNoise('sok 1 l').attrs.volumeMl, 1000);
    assert.equal(stripNoise('sok 500 ml').attrs.volumeMl, 500);
    assert.equal(stripNoise('sok 0,75 litr').attrs.volumeMl, 750);
    assert.equal(stripNoise('сок 1,5 л').attrs.volumeMl, 1500);
  });

  it('normalizes weight units to grams', () => {
    assert.equal(stripNoise('shakar 1 kg').attrs.weightG, 1000);
    assert.equal(stripNoise('shakar 500 gr').attrs.weightG, 500);
    assert.equal(stripNoise('шакар 250 гр').attrs.weightG, 250);
    assert.equal(stripNoise('dori 500 mg').attrs.weightG, 0.5);
  });

  it('reads comma decimals as well as points', () => {
    assert.equal(stripNoise('sut 1,5 l').attrs.volumeMl, 1500);
    assert.equal(stripNoise('sut 1.5 l').attrs.volumeMl, 1500);
  });

  it('extracts pack counts from several notations', () => {
    assert.equal(stripNoise('paket x 6').attrs.packCount, 6);
    assert.equal(stripNoise('paket 12 dona').attrs.packCount, 12);
    assert.equal(stripNoise('paket (90 дона)').attrs.packCount, 90);
    assert.equal(stripNoise('paket 24 шт.').attrs.packCount, 24);
  });

  it('keeps dimensions whole instead of reading them as a multiplier', () => {
    const r = stripNoise('gilam 200x300');
    assert.equal(r.attrs.dimensions, '200x300');
    assert.equal(r.attrs.packCount, null);
  });

  it('extracts a percentage', () => {
    assert.equal(stripNoise('sut 2,5%').attrs.percent, 2.5);
    assert.equal(stripNoise('жирность 20%').attrs.percent, 20);
  });

  it('extracts vendor/model codes', () => {
    const r = stripNoise('Elektr choynak BQ KT2049G');
    assert.deepEqual(r.attrs.vendorCodes, ['KT2049G']);
    assert.equal(r.core, 'Elektr choynak BQ');
  });

  it('does not mistake a measurement for a vendor code', () => {
    const r = stripNoise('shakar 500g');
    assert.deepEqual(r.attrs.vendorCodes, []);
    assert.equal(r.attrs.weightG, 500);
  });

  it('does not treat a bare word as a unit', () => {
    // "litr" with no number in front must stay part of the name.
    const r = stripNoise('litr shishasi');
    assert.equal(r.attrs.volumeMl, null);
    assert.equal(r.core, 'litr shishasi');
  });

  it('does not split a unit out of the middle of a word', () => {
    // "gramm" inside "grammofon" must not be stripped.
    const r = stripNoise('5 grammofon');
    assert.equal(r.attrs.weightG, null);
  });

  it('reports what it removed', () => {
    const r = stripNoise('Coca-Cola 1.5L x 6');
    assert.ok(r.removed.some((x) => x.includes('1.5L')));
  });

  it('leaves a clean name untouched', () => {
    const r = stripNoise('Portlandsement');
    assert.equal(r.core, 'Portlandsement');
    assert.equal(r.attrs.volumeMl, null);
    assert.equal(r.attrs.weightG, null);
    assert.deepEqual(r.attrs.vendorCodes, []);
  });

  it('handles empty and punctuation-only input', () => {
    assert.equal(stripNoise('').core, '');
    assert.equal(stripNoise('   ').core, '');
  });

  it('takes the first quantity when several appear', () => {
    const r = stripNoise('sut 1 l 500 ml');
    assert.equal(r.attrs.volumeMl, 1000);
  });

  it('parses a real catalogue attribute string', () => {
    const r = stripNoise('oliy navli, vakuumli qadoqda 500 gr');
    assert.equal(r.attrs.weightG, 500);
    assert.equal(r.core, 'oliy navli, vakuumli qadoqda');
  });
});

describe('stripNoise on metal price lists', () => {
  it('reads a Cyrillic х between numbers as a dimension sign', () => {
    const r = stripNoise('Труба ВГП 15х2,5');
    assert.equal(r.attrs.dimensions, '15х2,5');
    assert.deepEqual(r.attrs.vendorCodes, []);
    assert.equal(r.core, 'Труба ВГП');
  });

  it('keeps slash-separated alternative wall thicknesses inside the dimension', () => {
    const r = stripNoise('Трубы эл/св 76х2,8/3,0/3,5');
    assert.equal(r.attrs.dimensions, '76х2,8/3,0/3,5');
    assert.equal(r.core, 'Трубы эл/св');
  });

  it('takes three-part sheet sizes whole', () => {
    const r = stripNoise('Лист г/к 5,00х1500х6000');
    assert.equal(r.attrs.dimensions, '5,00х1500х6000');
    assert.equal(r.core, 'Лист г/к');
  });

  it('does not strip the х of an abbreviation as a stranded multiplier', () => {
    assert.equal(stripNoise('Лист х/к 0,8х1250х2500').core, 'Лист х/к');
    assert.equal(stripNoise('List x/k').core, 'List x/k');
  });
});

describe('attrsKey', () => {
  const key = (name: string): string => attrsKey(stripNoise(name).attrs);

  it('is the same for the same pack written two ways', () => {
    assert.equal(key('Coca-Cola 1.5L'), key('Coca Cola 1,5 l'));
    assert.equal(key('Лист г/к 5,00х1500х6000'), key('Лист г/к 5x1500x6000'));
  });

  it('differs when a size differs', () => {
    assert.notEqual(key('Труба ВГП 15х2,5'), key('Труба ВГП 20х2,5'));
    assert.notEqual(key('Coca-Cola 1.5L'), key('Coca-Cola 0.5L'));
    assert.notEqual(key('Shakar 1 kg'), key('Shakar 1 kg x 6'));
  });

  it('is empty when nothing was extracted', () => {
    assert.equal(key('Kartoshka'), '');
  });
});

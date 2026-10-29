import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attrsKey, measuresIn, stripNoise, withoutPackBreakdown } from './noise.js';

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

describe('pharmacy packs and strengths', () => {
  it('reads "№28(2x14)" as a pack of 28, not a 2x14 size, and keeps "№28" in the name', () => {
    const r = stripNoise('ЭДАРБИ Таблетки 80 мг блистеры №28(2x14)');
    assert.equal(r.attrs.packCount, 28);
    assert.equal(r.attrs.dimensions, null);
    assert.equal(r.core, 'ЭДАРБИ Таблетки блистеры №28');
    assert.ok(r.removed.includes('(2x14)'));
  });

  it('takes the Cyrillic х and spaces inside the breakdown too', () => {
    assert.equal(stripNoise('Таблетки №28 (4 х 7)').attrs.packCount, 28);
    assert.equal(stripNoise('Таблетки №28 (4 х 7)').attrs.dimensions, null);
  });

  it('leaves a real size alone', () => {
    assert.equal(stripNoise('Труба ВГП 15х2,5').attrs.dimensions, '15х2,5');
  });

  it('withoutPackBreakdown keeps the count', () => {
    assert.equal(withoutPackBreakdown('ЭНАМ® 5мг №100(10x10)').trim(), 'ЭНАМ® 5мг №100');
  });

  it('measuresIn reads micrograms and per cents as strengths', () => {
    assert.deepEqual(measuresIn('Aэрозоль 250 мкг/доза 60доза').map((m) => [m.kind, m.value]), [['weight', 0.00025]]);
    assert.deepEqual(measuresIn('Капли 0,1% 2.5мл').map((m) => [m.kind, m.value]), [['volume', 2.5], ['percent', 0.1]]);
    assert.deepEqual(measuresIn('Гель 1.25 % 60г').map((m) => [m.kind, m.value]), [['weight', 60], ['percent', 1.25]]);
  });

  it('measuresIn reads a strength per volume as one concentration in mg per ml, apart from the vial', () => {
    assert.deepEqual(measuresIn('Раствор 15 мг/мл 2мл ампулы').map((m) => [m.kind, m.value]), [['concentration', 15], ['volume', 2]]);
    assert.deepEqual(measuresIn('Раствор 15 мг/2 мл 2миллилитр').map((m) => [m.kind, m.value]), [['concentration', 7.5], ['volume', 2]]);
    // "500 мг/100 мл" and "5 мг/мл" are one strength.
    assert.deepEqual(measuresIn('Раствор для инфузий 500 мг/100 мл 100мл').map((m) => [m.kind, m.value]), [['concentration', 5], ['volume', 100]]);
    assert.deepEqual(measuresIn('Раствор для инфузий 5мг/мл 100мл').map((m) => [m.kind, m.value]), [['concentration', 5], ['volume', 100]]);
    assert.deepEqual(measuresIn('Раствор 50 мкг/мл 2мл').map((m) => [m.kind, m.value]), [['concentration', 0.05], ['volume', 2]]);
    assert.deepEqual(measuresIn('Капли 0,05 мг/мл + 5 мг/мл 2.5мл').map((m) => [m.kind, m.value]), [['concentration', 0.05], ['concentration', 5], ['volume', 2.5]]);
    // Per dose or per gram is not a concentration per volume: read as before.
    assert.deepEqual(measuresIn('Aэрозоль 250 мкг/доза').map((m) => [m.kind, m.value]), [['weight', 0.00025]]);
    assert.equal(measuresIn('Раствор 15 мг/мл 2мл')[0]?.text, '15 мг/мл');
  });
});

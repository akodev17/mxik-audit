import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { brandFold, brandWords, earnsIdentifying, identifyingMatch, identifyingQuery, rowIdentity } from './identifying.js';
import type { MxikCandidate } from './types.js';

function code(overrides: Partial<MxikCandidate>): MxikCandidate {
  return {
    code: '00000000000000001', nameUz: '', nameRu: '',
    groupName: null, className: null, positionName: null, subPositionName: null,
    brandName: null, attributeName: null, subPositionCode: '00000000000', isBase: false, isMarked: false,
    unitBinding: 'none', unitCanonical: [], unitRaw: null, unitContainer: null, barcode: null,
    ...overrides,
  };
}

// Classifier rows as stored (uz brand and attribute fields, both names), 2026-10-28.
const PANADOL = code({
  code: '03004452001001004', isMarked: true,
  brandName: 'ПАНАДОЛ (GlaxoSmithKline Consumer Healthcare (UK))', attributeName: 'Tabletkalar 500 mg blisterlar №12(1x12)',
  nameUz: 'Paratsetamol - N02BE01: PANADOL (GlaxoSmithKline Consumer Healthcare (UK)), Tabletkalar 500 mg blisterlar №12(1x12)',
  nameRu: 'Парацетамол - N02BE01: ПАНАДОЛ (GlaxoSmithKline Consumer Healthcare (UK)), Таблетки 500 мг блистеры №12(1x12)',
  positionName: 'Anilidlar (Boshqa analjeziklar va antipiretiklar) -N02BE', subPositionName: 'Paratsetamol - N02BE01',
});
const COCA_COLA = code({
  code: '02202002001010009', isMarked: true, brandName: 'COCA-COLA', attributeName: 'shirin, PET butilka 1,5 l.',
  nameUz: 'Alkogolsiz ichimliklar (gazlangan va gazlanmagan): COCA-COLA, shirin, PET butilka 1,5 l.',
  nameRu: 'Безалкогольные напитки (газированные и негазированные): COCA-COLA, сладкий, ПЭТ бутылка 1,5 л.',
  positionName: 'Salqin alkogolsiz ichimliklar', subPositionName: 'Alkogolsiz ichimliklar (gazlangan va gazlanmagan)',
});
const BAGCA_SARAY = code({
  code: '02202002001092003', isMarked: true, brandName: 'Bagca Saray', attributeName: 'Koka kola, PET butilka 1,5 l',
  nameUz: 'Alkogolsiz ichimliklar (gazlangan va gazlanmagan): Bagca Saray, Koka kola, PET butilka 1,5 l',
  nameRu: 'Безалкогольные напитки (газированные и негазированные): Bagca Saray, Кока кола, ПЭТ бутылка 1,5 л',
});
const VGP_15 = code({
  code: '07306001005015618', isMarked: false, brandName: null,
  attributeName: '2ps markali po’latdan tayyorlangan suv-gaz quvuri, tashqi diametri 15 mm, devor qalinligi 2,5 mm, uzunligi 6000 mm, 0,305 kg/m',
  nameUz: 'Po’lat quvur (o’ralgan po’lat):  , 2ps markali po’latdan tayyorlangan suv-gaz quvuri, tashqi diametri 15 mm, devor qalinligi 2,5 mm, uzunligi 6000 mm, 0,305 kg/m',
  nameRu: 'Стальная труба (шовная):  , Труба стальная водогазопроводная из стали марки Ст2пс, наружный диаметр 15 мм, толщина стенки 2,5 мм, длина 6000 мм, 0,305 кг/м',
});
const VGP_100 = code({
  code: '07306001005003162', isMarked: null, brandName: '3',
  attributeName: 'Suv va gaz quvurlari uchun mo’ljallangan po’lat quvur, diametri 100 mm, devori qalinligi 4,6 mm , uzunligi 10000 mm',
  nameUz: 'Po’lat quvur (o’ralgan po’lat): 3, Suv va gaz quvurlari uchun mo’ljallangan po’lat quvur, diametri 100 mm, devori qalinligi 4,6 mm , uzunligi 10000 mm',
  nameRu: 'Стальная труба (шовная): 3, Труба стальная водогазопроводная диаметр 100 мм, толщиной стенки 4,6 мм , длина 10000 мм',
});
const LENOVO = code({
  code: '08471001001002060', isMarked: false, brandName: 'Lenovo', attributeName: 'IdeaPad 5 15IAL7',
  nameUz: 'Noutbuk: Lenovo, IdeaPad 5 15IAL7', nameRu: 'Ноутбук: Lenovo, IdeaPad 5 15IAL7',
  positionName: 'Portativ hisoblash mashinalari', subPositionName: 'Noutbuk',
});

const earns = (row: string, c: MxikCandidate): boolean => earnsIdentifying(identifyingMatch(rowIdentity(row), c));

describe('identifying codes: the four competitor cases (plan §1)', () => {
  it('PANADOL 500mg tabletka N12: brand, dosage and pack', () => {
    const m = identifyingMatch(rowIdentity('PANADOL 500mg tabletka N12'), PANADOL);
    assert.equal(m.brand, 'ПАНАДОЛ');
    assert.deepEqual(m.attributes, ['500mg', 'N12']);
    assert.equal(earnsIdentifying(m), true);
  });

  it('Кока-Кола 1,5л пэт: the Cyrillic name matches the Latin brand, and the volume', () => {
    const m = identifyingMatch(rowIdentity('Кока-Кола 1,5л пэт'), COCA_COLA);
    assert.equal(m.brand, 'COCA-COLA');
    assert.deepEqual(m.attributes, ['1,5л']);
    assert.equal(earnsIdentifying(m), true);
  });

  it('Труба ВГП 15х2,5: an unbranded code with both sizes', () => {
    const m = identifyingMatch(rowIdentity('Труба ВГП 15х2,5'), VGP_15);
    assert.equal(m.brand, null);
    assert.deepEqual(m.attributes, ['15х2,5']);
    assert.equal(earnsIdentifying(m), true);
  });

  it('Ноутбук Lenovo IdeaPad 15: brand and a shared product word', () => {
    const m = identifyingMatch(rowIdentity('Ноутбук Lenovo IdeaPad 15'), LENOVO);
    assert.equal(m.brand, 'Lenovo');
    assert.equal(earnsIdentifying(m), true);
  });
});

describe('identifying codes: what does not earn one', () => {
  it('a generic name earns no identifying code', () => {
    assert.equal(earns('Парацетамол таблетка', PANADOL), false);
    assert.equal(earns('Безалкогольный напиток', COCA_COLA), false);
    assert.equal(earns('Труба ВГП', VGP_15), false);
    assert.equal(earns('Ноутбук', LENOVO), false);
  });

  it('another size of the same pipe does not', () => {
    assert.equal(earns('Труба ВГП 15х2,5', VGP_100), false);
    assert.equal(earns('Труба ВГП 20х2,5', VGP_15), false);
  });

  it('another brand never earns its code on the size alone', () => {
    const m = identifyingMatch(rowIdentity('Кока-Кола 1,5л пэт'), BAGCA_SARAY);
    assert.deepEqual(m.attributes, ['1,5л']);
    assert.equal(m.ownBrand, true);
    assert.equal(earnsIdentifying(m), false);
  });

  it('a stated volume, dosage or pack that differs contradicts the code, even with the brand', () => {
    assert.equal(earns('Кока-Кола 0,5л', COCA_COLA), false);
    assert.equal(earns('PANADOL 250mg', PANADOL), false);
    assert.equal(earns('PANADOL 500mg N24', PANADOL), false);
  });

  it('a brand alone is not enough when the code is another product of that brand', () => {
    const caviar = code({ brandName: 'Santa Bremor', nameRu: 'Икра рыбы: Santa Bremor, пастеризованная 90 г', nameUz: 'Baliq ikrasi: Santa Bremor, 90 g' });
    assert.equal(earns('Santa Bremor Kosmetk желе', caviar), false);
  });

  it('a size alone is not enough when the code is named like another product', () => {
    const sheet = code({ nameRu: 'Прокат листовой горячекатаный, толщина 12 мм', nameUz: 'Issiq prokat list, qalinligi 12 mm' });
    assert.equal(earns('Арматура 12 мм', sheet), false);
  });

  it('base codes are never identifying', () => {
    assert.deepEqual(identifyingMatch(rowIdentity('PANADOL 500mg'), { ...PANADOL, isBase: true }).attributes, []);
  });
});

describe('brand words', () => {
  it('drops the maker in parentheses, digit-only values, placeholders and hierarchy words', () => {
    assert.deepEqual(brandWords(PANADOL), ['panadol']);
    assert.deepEqual(brandWords(VGP_100), []);
    assert.deepEqual(brandWords(code({ brandName: 'NO BRAND' })), []);
    assert.deepEqual(brandWords(code({ brandName: 'SEMENT', positionName: 'Sement' })), []);
    assert.deepEqual(brandWords(code({ brandName: 'LG' })), ['lg']);
  });

  it('folds Latin and Cyrillic spellings of a brand together', () => {
    assert.equal(brandFold('coca'), brandFold('koka'));
    assert.equal(brandFold('shhow'), brandFold('show'));
  });
});

describe('identifyingQuery', () => {
  it('adds the numbers, glued tokens and c spellings normalization strips', () => {
    assert.equal(identifyingQuery('panadol tabletka', 'PANADOL 500mg tabletka N12'), 'panadol tabletka tabletca 500 12 500mg mg');
    assert.equal(identifyingQuery('koka kola pet', 'Кока-Кола 1,5л пэт'), 'koka kola pet coca cola 1 5');
    assert.equal(identifyingQuery('truba vodogazoprovodnaya', 'Труба ВГП 15х2,5'), 'truba vodogazoprovodnaya 15 2 5');
  });

  it('is null when it would add nothing', () => {
    assert.equal(identifyingQuery('guruch botqasi', "Guruch bo'tqasi"), null);
  });
});

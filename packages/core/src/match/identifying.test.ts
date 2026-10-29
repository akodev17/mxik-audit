import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { brandFold, brandWords, earnsIdentifying, identifyingMatch, identifyingQuery, namesBrandOf, rowIdentity } from './identifying.js';
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

// Pharmacy rows from the 2026-10 reference-price register (docs/MATCHING_V2_PLAN.md §9).
const pharma = (code_: string, brandName: string, attributeName: string, sub = 'Метронидазол - P01AB01'): MxikCandidate => code({
  code: code_, isMarked: true, brandName, attributeName, subPositionName: sub,
  nameRu: `${sub}: ${brandName}, ${attributeName}`, nameUz: `${sub}: ${brandName}, ${attributeName}`,
});

describe('identifying codes: pharmacy packs and strengths', () => {
  it('a pack breakdown "№100(10x10)" is no 10x10 size', () => {
    const generic = pharma('03004332001056002', 'Метронидазол (Samarkand England Ecomedical)', 'Таблетки блистеры №100(10x10)');
    const row = rowIdentity('ЭНАМ® Таблетки 5мг блистеры №100(10x10)');
    assert.equal(row.size, null);
    assert.equal(row.breakdown, '10x10');
    // The pack and its layout, never a "10x10" size that any code with two tens would repeat.
    assert.deepEqual(identifyingMatch(row, generic).attributes, ['№100', '(10x10)']);
  });

  it('the same breakdown is an attribute of its own', () => {
    const blister = pharma('03004337002001006', 'СПАРЕКС® (Канонфарма продакшн)', 'Капсулы 200 мг блистеры №30(3x10)', 'Мебеверин - A03AA04');
    const strip = pharma('03004337002001007', 'СПАРЕКС® (Канонфарма продакшн)', 'Капсулы 200 мг блистеры №30(2x15)', 'Мебеверин - A03AA04');
    const row = rowIdentity('СПАРЕКС® Капсулы 200 мг блистеры №30(3x10)');
    assert.deepEqual(identifyingMatch(row, blister).attributes, ['200 мг', '№30', '(3x10)']);
    assert.deepEqual(identifyingMatch(row, strip).attributes, ['200 мг', '№30']);
  });

  it('another strength in micrograms or per cent contradicts the code', () => {
    const selefly125 = pharma('03004532004006002', 'СЕЛЕФЛУ (Jewim Pharmaceutical (Shandong))', 'Aэрозоль для ингаляций 125 мкг/доза 60доза ингалятор', 'Флутиказон - R03BA05');
    assert.equal(earns('СЕЛЕФЛУ Aэрозоль для ингаляций 250 мкг/доза 60доза ингалятор', selefly125), false);
    assert.equal(earns('СЕЛЕФЛУ Aэрозоль для ингаляций 125 мкг/доза 60доза ингалятор', selefly125), true);
    const semax1 = pharma('03004499001001001', 'СЕМАКС (ИНПЦ "Пептоген")', 'Капли назальные 1% 2.5мл флаконы', 'Семакс - N06BX');
    assert.equal(earns('СЕМАКС Капли назальные 0,1% 2.5мл флаконы', semax1), false);
  });

  it('a strength per volume is compared per millilitre, whatever the spelling', () => {
    const perMl = pharma('03004554005059001', 'АМБРОКСОЛ (Dongkwang Pharm)', 'Раствор для инъекций 15 мг/мл 2миллилитр ампулы №10(1x10)', 'Амброксол - R05CB06');
    const perAmpoule = pharma('03004554005069002', 'АМБРОКСОЛ (Radiks)', 'Раствор для инъекций 15 мг/2 мл 2миллилитр ампулы №10(1x10)', 'Амброксол - R05CB06');
    const row = rowIdentity('АМБРОКСОЛ Раствор для инъекций 15 мг/мл 2мл ампулы №10(1x10)');
    assert.deepEqual(identifyingMatch(row, perMl).attributes, ['15 мг/мл', '2мл', '№10', '(1x10)']);
    assert.equal(identifyingMatch(row, perMl).conflict, false);
    // "15 мг/2 мл" is the same 15 mg ampoule under the register's other spelling: compatible, but not the row's strength.
    assert.deepEqual(identifyingMatch(row, perAmpoule).attributes, ['2мл', '№10', '(1x10)']);
    assert.equal(identifyingMatch(row, perAmpoule).conflict, false);
    // Another mass at another strength is another ampoule.
    const double = pharma('03004554005059009', 'АМБРОКСОЛ (Dongkwang Pharm)', 'Раствор для инъекций 30 мг/мл 2миллилитр ампулы №10(1x10)', 'Амброксол - R05CB06');
    assert.equal(identifyingMatch(row, double).conflict, true);
    assert.equal(earnsIdentifying(identifyingMatch(row, double)), false);
    // "500 мг/100 мл" is "5 мг/мл".
    const total = pharma('03004326008214001', 'ЛЕВАНТА (Jurabek)', 'Раствор для инфузий 500 мг/100 мл 100мл флаконы', 'Левофлоксацин - J01MA12');
    const m = identifyingMatch(rowIdentity('ЛЕВАНТА Раствор для инфузий 5 мг/мл 100мл флаконы'), total);
    assert.deepEqual(m.attributes, ['5 мг/мл', '100мл']);
    assert.equal(m.conflict, false);
    // The classifier's "50 мг/мл 2 мл" for a 50 mg/2 ml ampoule (row 274 of the pharmacy register) is the same mass.
    const sloppy = pharma('03004411007088001', 'Дексап (BAYAN MEDICAL)', 'раствор для инъекций 50 мг/мл 2 мл №5', 'Декскетопрофен - M01AE17');
    assert.equal(identifyingMatch(rowIdentity('Дексап Раствор для инъекций 50 мг/2 мл 2мл ампулы №5(1x5)'), sloppy).conflict, false);
  });

  it('a row that names no pack is not the code\'s box of ten', () => {
    const vial = pharma('03004314001001001', 'ЗИДИМБИОТИК (Tenamyd Pharmaceutical)', 'Порошок для приготовления инъекционного раствора 1000 мг флаконы', 'Цефтазидим - J01DD02');
    const box = pharma('03004314001001002', 'ЗИДИМБИОТИК (Tenamyd Pharmaceutical)', 'Порошок для приготовления инъекционного раствора 1000 мг флаконы №10(10x1)', 'Цефтазидим - J01DD02');
    const row = 'ЗИДИМБИОТИК Порошок для приготовления инъекционного раствора 1000 мг флаконы';
    assert.equal(earns(row, vial), true);
    assert.equal(earns(row, box), false);
  });

  it('reads "10шт." as a pack count', () => {
    assert.deepEqual(rowIdentity('Лосавин® 100 Таблетки 100 мг 10шт. блистеры').pack, { text: '10шт.', count: 10 });
  });

  it('measures in parentheses spell out the parts only when the name states no total', () => {
    const santal = pharma('03004314018037001', 'Сантал (ИП ООО АТМ SANITA PHARMA)', 'порошок для приготовления инъекционного раствора 1,5 г № 1', 'Цефоперазон и сульбактам - J01DD62');
    assert.equal(earns('Сантал Порошок для приготовления инъекционного раствора 1,5 г (1,0г+0,5г) флаконы', santal), true);
    assert.deepEqual(rowIdentity('Таблетки (500 мг)').measures.map((m) => m.value), [0.5]);
  });

  it('a brand with a suffix letter is another product than the bare brand', () => {
    const plain = pharma('03004339001001001', 'Ситафор (ИП ООО Novugen Pharma)', 'Таблетки покрытые оболочкой 100 мг блистеры №30(3x10)', 'Ситаглиптин - A10BH01');
    const metformin = pharma('03004339001002001', 'Ситафор-M (ИП ООО Novugen Pharma)', 'Таблетки покрытые оболочкой 50 мг + 850 мг №28(2x14)', 'Ситаглиптин и метформин - A10BD07');
    const row = rowIdentity('Ситафор® Таблетки покрытые оболочкой 100 мг №30(3x10)');
    assert.equal(identifyingMatch(row, plain).brand, 'Ситафор');
    assert.deepEqual(identifyingMatch(row, plain).brandWords, ['sitafor']);
    assert.equal(identifyingMatch(row, metformin).brand, null);
    assert.deepEqual(identifyingMatch(rowIdentity('Ситафор-M Таблетки 50 мг + 850 мг'), metformin).brandWords, ['sitafor', 'm']);
  });

  it('namesBrandOf wants the code\'s own part to repeat the row, not just its position', () => {
    const juice = code({
      code: '02009001006053002', isMarked: true, brandName: 'Nestle', attributeName: 'Multifrukt, Tetra pak 1 l',
      nameUz: 'Meva va sabzavot sharbatlari (barcha turdagi): Nestle, Multifrukt, Tetra pak 1 l',
      nameRu: 'Фруктовые и овощные соки (всех видов): Nestle, Мультифрукт, Тетра пак 1 л',
    });
    const scooter = identifyingMatch(rowIdentity('NESTLE ELEKTROSAMOKATLAR (BARCHA TURDAGI)'), juice);
    assert.equal(earnsIdentifying(scooter), true); // the position shares "barcha turdagi"
    assert.equal(namesBrandOf(scooter), false);
    assert.equal(namesBrandOf(identifyingMatch(rowIdentity('Nestle Multifrukt 1 l'), juice)), true);
  });

  it('identifyingQuery keeps the pack count and drops the breakdown', () => {
    assert.equal(identifyingQuery('enam tabletki blisteri', 'ЭНАМ® Таблетки 5мг блистеры №100(10x10)'), 'enam tabletki blisteri tabletci 5 100 5mg mg');
  });
});

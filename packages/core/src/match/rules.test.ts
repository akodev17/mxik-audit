import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeName } from '../normalize/index.js';
import { rowIdentity } from './identifying.js';
import { applyRules, hierarchyPath, isPreparedDish } from './rules.js';
import type { MxikCandidate } from './types.js';

function candidate(overrides: Partial<MxikCandidate> = {}): MxikCandidate {
  return {
    code: '01901001003000000',
    nameUz: 'Guruch boʻtqasi',
    nameRu: 'Рисовая каша',
    groupName: 'UN, QANDOLAT',
    className: 'Boʻtqalar',
    positionName: 'Guruch boʻtqasi',
    subPositionName: 'Guruch boʻtqasi',
    brandName: null,
    attributeName: null,
    subPositionCode: '01901001003',
    isBase: true,
    isMarked: false,
    unitBinding: 'none',
    unitCanonical: [],
    unitRaw: null,
    unitContainer: null,
    barcode: null,
    ...overrides,
  };
}

describe('isPreparedDish', () => {
  it('detects dishes in both scripts and spellings', () => {
    for (const name of ['Palov 1 porsiya', 'Палов', 'plov', 'Manti 10 dona', 'Kabob', 'Somsa']) {
      assert.equal(isPreparedDish(name), true, `failed for ${name}`);
    }
  });

  it('detects food-service context', () => {
    assert.equal(isPreparedDish('Restoran xizmati'), true);
    assert.equal(isPreparedDish('Oshxona taomlari'), true);
  });

  it('does not fire on a single word merely containing a dish name', () => {
    // "osh" must not match inside "oshqozon" (stomach).
    assert.equal(isPreparedDish('Oshqozon dorisi'), false);
    assert.equal(isPreparedDish('Poshshalik'), false);
  });

  it('does not fire on ordinary goods', () => {
    for (const name of ['Kartoshka', 'Sement M400', 'Coca-Cola 1.5L', 'Guruch boʻtqasi']) {
      assert.equal(isPreparedDish(name), false, `false positive on ${name}`);
    }
  });

  it('handles empty input', () => {
    assert.equal(isPreparedDish(''), false);
    assert.equal(isPreparedDish('   '), false);
  });
});

describe('applyRules', () => {
  it('rewards a base code', () => {
    const r = applyRules({ candidate: candidate({ isBase: true }), rowUnit: null, preparedDish: false });
    assert.ok(r.adjustment > 0);
    assert.ok(r.notes.some((n) => n.includes('Base code')));
  });

  it('penalises an identifying code for an unmarked category', () => {
    const r = applyRules({
      candidate: candidate({ isBase: false, isMarked: false }),
      rowUnit: null, preparedDish: false,
    });
    assert.ok(r.adjustment < 0);
  });

  it('penalises an unmarked identifying code more than an unknown-marking one', () => {
    const unmarked = applyRules({ candidate: candidate({ isBase: false, isMarked: false }), rowUnit: null, preparedDish: false });
    const unknown = applyRules({ candidate: candidate({ isBase: false, isMarked: null }), rowUnit: null, preparedDish: false });
    assert.ok(unmarked.adjustment < unknown.adjustment);
  });

  it('accepts an identifying code for a marked category', () => {
    const r = applyRules({
      candidate: candidate({ isBase: false, isMarked: true }),
      rowUnit: null, preparedDish: false,
    });
    assert.ok(r.adjustment > 0);
  });

  it('says so when marking is unknown rather than assuming', () => {
    const r = applyRules({ candidate: candidate({ isBase: false, isMarked: null }), rowUnit: null, preparedDish: false });
    assert.ok(r.notes.some((n) => n.includes('does not state')));
  });

  it('pushes a prepared dish toward the general code', () => {
    const general = applyRules({ candidate: candidate({ isBase: true }), rowUnit: null, preparedDish: true });
    const specific = applyRules({ candidate: candidate({ isBase: false, isMarked: false }), rowUnit: null, preparedDish: true });
    assert.ok(general.adjustment > specific.adjustment);
  });

  it('flags a conflict against a strictly bound unit', () => {
    const r = applyRules({
      candidate: candidate({ unitBinding: 'strict', unitCanonical: ['kilogramm'] }),
      rowUnit: 'litr', preparedDish: false,
    });
    assert.equal(r.unitConflict, true);
    assert.ok(r.adjustment < 0);
  });

  it('accepts a matching unit written in another notation', () => {
    const r = applyRules({
      candidate: candidate({ unitBinding: 'strict', unitCanonical: ['kilogramm'] }),
      rowUnit: 'кг', preparedDish: false,
    });
    assert.equal(r.unitConflict, false);
  });

  it('never flags a conflict for a recommended-only binding', () => {
    // 4,223 codes are recommended-only; those must never produce findings.
    const r = applyRules({
      candidate: candidate({ unitBinding: 'recommended', unitCanonical: ['kilogramm'] }),
      rowUnit: 'litr', preparedDish: false,
    });
    assert.equal(r.unitConflict, false);
  });

  it('never flags a conflict when the binding is none', () => {
    const r = applyRules({
      candidate: candidate({ unitBinding: 'none', unitCanonical: [] }),
      rowUnit: 'litr', preparedDish: false,
    });
    assert.equal(r.unitConflict, false);
  });

  it('never flags a conflict when the row has no unit', () => {
    const r = applyRules({
      candidate: candidate({ unitBinding: 'strict', unitCanonical: ['kilogramm'] }),
      rowUnit: null, preparedDish: false,
    });
    assert.equal(r.unitConflict, false);
  });

  it('accepts any member of a multi-unit strict binding', () => {
    const r = applyRules({
      candidate: candidate({ unitBinding: 'strict', unitCanonical: ['tonna', 'kilogramm', 'gramm'] }),
      rowUnit: 'kg', preparedDish: false,
    });
    assert.equal(r.unitConflict, false);
  });
});

describe('applyRules: recommended units', () => {
  const steel = candidate({ isBase: true, unitBinding: 'recommended', unitCanonical: [], recommendedUnits: ['tonna'] });
  const fitting = candidate({ isBase: true, unitBinding: 'recommended', unitCanonical: [], recommendedUnits: ['dona'] });
  const keys = (r: ReturnType<typeof applyRules>) => r.keys.filter((k) => k !== 'baseCodePreferred');

  it('rewards a row unit the classifier recommends', () => {
    const r = applyRules({ candidate: steel, rowUnit: 'тонна', preparedDish: false });
    assert.deepEqual(keys(r), ['recommendedUnitMatch']);
    assert.ok(Math.abs(r.adjustment - (0.05 + 0.03)) < 1e-9);
  });

  it('penalises a code recommended in pieces for a row sold by the tonne, gently and without a conflict', () => {
    const r = applyRules({ candidate: fitting, rowUnit: 'тонна', preparedDish: false });
    assert.deepEqual(keys(r), ['unitKindMismatch']);
    assert.ok(Math.abs(r.adjustment - (0.05 - 0.05)) < 1e-9);
    assert.equal(r.unitConflict, false);
  });

  it('leaves units of the same kind alone: kg against tonnes converts', () => {
    assert.deepEqual(keys(applyRules({ candidate: steel, rowUnit: 'кг', preparedDish: false })), []);
  });

  it('never penalises a row sold in pieces: a piece can hold metres (plinth sold "шт", run 27)', () => {
    const plinth = candidate({ isBase: true, unitBinding: 'recommended', unitCanonical: [], recommendedUnits: ['metr'] });
    assert.deepEqual(keys(applyRules({ candidate: plinth, rowUnit: 'шт', preparedDish: false })), []);
  });

  it('judges nothing it cannot resolve, and never a strict or unbound code', () => {
    assert.deepEqual(keys(applyRules({ candidate: fitting, rowUnit: 'мешок', preparedDish: false })), []);
    assert.deepEqual(keys(applyRules({ candidate: fitting, rowUnit: null, preparedDish: false })), []);
    assert.deepEqual(keys(applyRules({ candidate: candidate({ isBase: true, unitBinding: 'recommended', recommendedUnits: ['qop'] }), rowUnit: 'тонна', preparedDish: false })), []);
    const strict = candidate({ isBase: true, unitBinding: 'strict', unitCanonical: ['dona'], recommendedUnits: ['dona'] });
    assert.deepEqual(keys(applyRules({ candidate: strict, rowUnit: 'тонна', preparedDish: false })), ['strictUnitConflict']);
    const none = candidate({ isBase: true, unitBinding: 'none', recommendedUnits: ['dona'] });
    assert.deepEqual(keys(applyRules({ candidate: none, rowUnit: 'тонна', preparedDish: false })), []);
  });
});

describe('hierarchyPath', () => {
  it('joins the four levels', () => {
    assert.equal(
      hierarchyPath(candidate()),
      'UN, QANDOLAT → Boʻtqalar → Guruch boʻtqasi → Guruch boʻtqasi',
    );
  });

  it('skips missing levels instead of leaving empty separators', () => {
    const path = hierarchyPath(candidate({ className: null, positionName: null }));
    assert.equal(path, 'UN, QANDOLAT → Guruch boʻtqasi');
  });

  it('returns empty when nothing is known', () => {
    assert.equal(
      hierarchyPath(candidate({ groupName: null, className: null, positionName: null, subPositionName: null })),
      '',
    );
  });
});

describe('applyRules: unrequested material', () => {
  const sheet = (code: string, nameRu: string) => candidate({ code, nameRu, nameUz: nameRu, isBase: true, unitBinding: 'none' });
  const stainless = sheet('07219001001000007', 'Прокат плоский из коррозионностойкой стали, Лист горячекатаный из нержавеющей стали');
  const carbon = sheet('07208001001000552', 'Плоский прокат из железа, Лист стальной горячекатаный');
  const tokens = (name: string) => normalizeName(name).tokens;

  it('marks down a semi-product of a metal the row never names', () => {
    const r = applyRules({ candidate: stainless, rowUnit: null, preparedDish: false, productTokens: tokens('Лист г/к 2,0х1250х2500') });
    assert.ok(r.keys.includes('unrequestedMaterial'));
    const plain = applyRules({ candidate: carbon, rowUnit: null, preparedDish: false, productTokens: tokens('Лист г/к 2,0х1250х2500') });
    assert.ok(!plain.keys.includes('unrequestedMaterial'));
  });

  it('leaves the metal alone when the row names it, in either language or as an abbreviation', () => {
    for (const name of ['Лист нержавеющий 2мм', 'Лист н/ж 2мм', 'Zanglamaydigan list 2 mm']) {
      assert.ok(!applyRules({ candidate: stainless, rowUnit: null, preparedDish: false, productTokens: tokens(name) }).keys.includes('unrequestedMaterial'), name);
    }
  });

  it('only judges metal semi-products, never finished articles such as a stainless pot', () => {
    const pot = sheet('07323001001000000', 'Кастрюля из нержавеющей стали');
    assert.ok(!applyRules({ candidate: pot, rowUnit: null, preparedDish: false, productTokens: tokens('Кастрюля 5 л') }).keys.includes('unrequestedMaterial'));
  });

  it('needs the row words, so callers without them get the old behaviour', () => {
    assert.ok(!applyRules({ candidate: stainless, rowUnit: null, preparedDish: false }).keys.includes('unrequestedMaterial'));
  });
});

describe('identifyingPreferred', () => {
  const pipe = (overrides: Partial<MxikCandidate> = {}): MxikCandidate => candidate({
    code: '07306001005015618', subPositionCode: '07306001005', isBase: false, isMarked: false,
    nameRu: 'Стальная труба (шовная): Труба стальная водогазопроводная, наружный диаметр 15 мм, толщина стенки 2,5 мм',
    nameUz: 'Po’lat quvur: suv-gaz quvuri, tashqi diametri 15 mm, devor qalinligi 2,5 mm',
    attributeName: 'suv-gaz quvuri, tashqi diametri 15 mm, devor qalinligi 2,5 mm',
    ...overrides,
  });
  const base = candidate({ code: '07306001005000000', subPositionCode: '07306001005', isBase: true, nameRu: 'Стальная труба (шовная)', nameUz: 'Po’lat quvur' });
  const rules = (name: string, c: MxikCandidate) => applyRules({ candidate: c, rowUnit: null, preparedDish: false, identity: rowIdentity(name) });

  it('outweighs baseCodePreferred when the name repeats the size of the code, replacing the unmarked penalty', () => {
    const identifying = rules('Труба ВГП 15х2,5', pipe());
    assert.deepEqual(identifying.keys, ['identifyingPreferred']);
    assert.deepEqual(identifying.identifyingTokens, ['15х2,5']);
    assert.ok(identifying.adjustment > rules('Труба ВГП 15х2,5', base).adjustment);
  });

  it('keeps baseCodePreferred ahead for a generic name', () => {
    const identifying = rules('Труба ВГП', pipe());
    assert.deepEqual(identifying.keys, ['identifyingUnmarked']);
    assert.deepEqual(identifying.identifyingTokens, []);
    assert.ok(rules('Труба ВГП', base).adjustment > identifying.adjustment);
  });

  it('keeps identifyingMarked for a marked code and adds the preference', () => {
    const r = rules('Кока-Кола 1,5л пэт', candidate({
      isBase: false, isMarked: true, brandName: 'COCA-COLA', attributeName: 'shirin, PET butilka 1,5 l.',
      nameRu: 'Безалкогольные напитки: COCA-COLA, сладкий, ПЭТ бутылка 1,5 л.', nameUz: 'Alkogolsiz ichimliklar: COCA-COLA, shirin, PET butilka 1,5 l.',
    }));
    assert.deepEqual(r.keys, ['identifyingMarked', 'identifyingPreferred']);
    assert.deepEqual(r.identifyingTokens, ['COCA-COLA', '1,5л']);
    assert.ok(Math.abs(r.adjustment - 0.11) < 1e-9);
  });

  it('never fires without the row identity', () => {
    const r = applyRules({ candidate: pipe(), rowUnit: null, preparedDish: false });
    assert.deepEqual(r.keys, ['identifyingUnmarked']);
  });
});

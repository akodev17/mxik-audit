import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
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

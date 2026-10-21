import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quantityKind, resolveUnit, unitIndexSize, unitsCompatible } from './units.js';

describe('resolveUnit', () => {
  it('resolves the same unit from four notations', () => {
    const ids = ['kilogramm', 'килограмм', 'kg', 'кг'].map((s) => resolveUnit(s)?.id);
    assert.equal(new Set(ids).size, 1, `expected one id, got ${JSON.stringify(ids)}`);
    assert.equal(ids[0], 5);
  });

  it('resolves the piece unit from its many spellings', () => {
    for (const form of ['dona', 'дона', 'sht', 'шт', 'pcs', 'pc']) {
      assert.equal(resolveUnit(form)?.id, 1, `failed for ${form}`);
    }
  });

  it('accepts either reading of ц', () => {
    // The portal writes центнер as "tsentner" but цемент as "sement".
    assert.equal(resolveUnit('tsentner')?.id, 6);
    assert.equal(resolveUnit('sentner')?.id, 6);
  });

  it('strips a leading quantity', () => {
    assert.equal(resolveUnit('500 gramm')?.id, resolveUnit('gramm')?.id);
    assert.equal(resolveUnit('0,75 litr')?.id, resolveUnit('litr')?.id);
  });

  it('handles the export\'s fused unit+packaging strings', () => {
    assert.equal(resolveUnit('dona (pэt butilka)  0.75 litr')?.id, 1);
    assert.equal(resolveUnit('dona (paket) 500 gramm')?.id, 1);
    assert.equal(resolveUnit('dona (tabletka (10 mg))')?.id, 1);
  });

  it('repairs Cyrillic homoglyphs inside Latin unit names', () => {
    assert.equal(resolveUnit('aэrozol qadoq')?.id, resolveUnit('aerozol qadoq')?.id);
  });

  it('ignores apostrophe variation', () => {
    const ids = ["to'plam", 'to’plam', 'toʻplam', 'toplam'].map((s) => resolveUnit(s)?.id);
    assert.equal(new Set(ids).size, 1);
  });

  it('resolves area and volume shorthands', () => {
    assert.equal(resolveUnit('m2')?.id, resolveUnit('kv. metr')?.id);
    assert.equal(resolveUnit('m3')?.id, resolveUnit('kub. metr')?.id);
  });

  it('returns null for junk rather than guessing', () => {
    assert.equal(resolveUnit('qwertyuiop'), null);
    assert.equal(resolveUnit(''), null);
    assert.equal(resolveUnit(null), null);
    assert.equal(resolveUnit(undefined), null);
  });

  it('built a non-trivial index', () => {
    assert.ok(unitIndexSize() > 200, `index only has ${unitIndexSize()} keys`);
  });
});

describe('unitsCompatible', () => {
  it('accepts a matching unit across notations', () => {
    assert.equal(unitsCompatible('kg', ['kilogramm']), true);
    assert.equal(unitsCompatible('кг', ['kilogramm']), true);
    assert.equal(unitsCompatible('шт', ['dona']), true);
  });

  it('rejects a genuine mismatch', () => {
    assert.equal(unitsCompatible('litr', ['kilogramm']), false);
    assert.equal(unitsCompatible('dona', ['metr']), false);
  });

  it('accepts a hit against any member of a multi-unit binding', () => {
    assert.equal(unitsCompatible('tonna', ['kilogramm', 'tonna', 'gramm']), true);
    assert.equal(unitsCompatible('litr', ['kilogramm', 'tonna', 'gramm']), false);
  });

  it('never flags a conflict when either side is unknown', () => {
    // UNIT_CONFLICT must not fire on our own inability to parse.
    assert.equal(unitsCompatible('qwertyuiop', ['kilogramm']), true);
    assert.equal(unitsCompatible('kg', ['qwertyuiop']), true);
    assert.equal(unitsCompatible(null, ['kilogramm']), true);
    assert.equal(unitsCompatible('kg', []), true);
  });
});

describe('quantityKind', () => {
  it('names what a unit measures, in any notation', () => {
    assert.equal(quantityKind('тонна'), 'mass');
    assert.equal(quantityKind('kg'), 'mass');
    assert.equal(quantityKind('шт'), 'count');
    assert.equal(quantityKind('лист'), 'count');
    assert.equal(quantityKind('pogono metr'), 'length');
    assert.equal(quantityKind('м2'), 'area');
    assert.equal(quantityKind('м3'), 'volume');
  });

  it('has no kind for units nobody judges, or text it cannot resolve', () => {
    assert.equal(quantityKind('soat'), null);
    assert.equal(quantityKind('мешок'), null);
    assert.equal(quantityKind(null), null);
  });
});

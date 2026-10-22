import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { identityKey, pairVersions, unchanged, type VersionItem } from './version-pairs.js';

let seq = 0;
function item(rawName: string, overrides: Partial<VersionItem> = {}): VersionItem {
  seq++;
  return { id: `i${seq}`, rowIndex: seq, rawName, unit: 'dona', barcode: null, existingMxik: '02202001001000000', ...overrides };
}

describe('unchanged (carry-over identity)', () => {
  it('holds for the same product written the same way, give or take case, spacing and word order', () => {
    assert.equal(unchanged(item('Coca-Cola 1,5 L'), item('coca cola 1.5l')), true);
    assert.equal(unchanged(item('Shakar oq 1 kg'), item('oq shakar 1kg')), true);
  });

  it('breaks on a different pack size, which the name fold alone would hide', () => {
    assert.equal(unchanged(item('Coca-Cola 0,5 L'), item('Coca-Cola 1,5 L')), false);
    assert.equal(unchanged(item('Tuxum 10 dona'), item('Tuxum 30 dona')), false);
  });

  it('breaks on a different code, unit or identifying barcode', () => {
    assert.equal(unchanged(item('Guruch'), item('Guruch', { existingMxik: '01901001003000000' })), false);
    assert.equal(unchanged(item('Guruch'), item('Guruch', { unit: 'kg' })), false);
    assert.equal(unchanged(item('Guruch', { barcode: '4780074540164' }), item('Guruch', { barcode: '4601501483581' })), false);
    assert.equal(unchanged(item('Guruch'), item('Guruch', { barcode: '4780074540164' })), false);
  });

  it('ignores barcodes that identify nothing (in-store or bad check digit)', () => {
    assert.equal(unchanged(item('Guruch', { barcode: '2000000000015' }), item('Guruch', { barcode: '2912345000004' })), true);
    assert.equal(unchanged(item('Guruch', { barcode: '4780074540165' }), item('Guruch')), true);
  });

  it('never calls two rows unchanged when their names fold to nothing', () => {
    assert.equal(identityKey(item('...')), null);
    assert.equal(unchanged(item('...'), item('---')), false);
  });

  it('ignores how the code was decorated in the spreadsheet', () => {
    assert.equal(unchanged(item('Guruch', { existingMxik: "'0220 2001 001 000000" }), item('Guruch')), true);
  });
});

describe('pairVersions', () => {
  it('pairs identical twins first, so pack-size variants do not cross over', () => {
    const prev = [item('Coca-Cola 0,5 L'), item('Coca-Cola 1,5 L')];
    const next = [item('Coca-Cola 1,5 L'), item('Coca-Cola 0,5 L')];
    const { pairs, added, removed } = pairVersions(prev, next);
    assert.equal(pairs.length, 2);
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
    for (const p of pairs) assert.equal(unchanged(p.prev, p.next), true, `${p.prev.rawName} -> ${p.next.rawName}`);
  });

  it('still pairs a changed row by name so the diff can show it', () => {
    const prev = [item('Guruch', { existingMxik: '01901001003000000' })];
    const next = [item('Guruch')];
    const [pair] = pairVersions(prev, next).pairs;
    assert.ok(pair);
    assert.equal(pair.by, 'name');
    assert.equal(unchanged(pair.prev, pair.next), false);
  });

  it('pairs by an identifying barcode even when the name changed', () => {
    const prev = [item('Pivo Amstel', { barcode: '4601501483581' })];
    const next = [item('Amstel pivo alkogolsiz', { barcode: '4601501483581' })];
    assert.equal(pairVersions(prev, next).pairs[0]?.by, 'barcode');
  });

  it('does not pair two different products through a shared in-store barcode', () => {
    const prev = [item('Kolbasa', { barcode: '2000000000015' })];
    const next = [item('Pishloq', { barcode: '2000000000015' })];
    const { pairs, added, removed } = pairVersions(prev, next);
    assert.deepEqual(pairs, []);
    assert.equal(added.length, 1);
    assert.equal(removed.length, 1);
  });

  it('uses each previous row once and reports the rest as added and removed', () => {
    const prev = [item('Guruch')];
    const next = [item('Guruch'), item('Guruch')];
    const { pairs, added } = pairVersions(prev, next);
    assert.equal(pairs.length, 1);
    assert.equal(added.length, 1);
  });
});

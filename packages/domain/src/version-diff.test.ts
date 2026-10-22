import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pairVersions, type VersionItem } from '@tasnivo/core/match/version-pairs';
import { changedFields, diffParts } from './version-diff.js';

let seq = 0;
function item(rawName: string, overrides: Partial<VersionItem> = {}): VersionItem {
  seq++;
  return { id: `i${seq}`, rowIndex: seq, rawName, unit: 'kg', barcode: null, existingMxik: '02202001001000000', ...overrides };
}
const set = (...ids: string[]): Set<string> => new Set(ids);

describe('version diff', () => {
  const rice = [item('Guruch Lazer 1 kg'), item('Guruch Lazer 1 kg')] as const;
  const sugar = [item('Shakar oq 1 kg'), item('Shakar oq 1 kg', { existingMxik: '01901001003000000' })] as const;
  const salt = [item('Tuz yodlangan 1 kg'), item('Tuz yodlangan 1 kg')] as const;
  const gone = item('Choy qora 100 g', { unit: 'dona' });
  const added = item('Kofe 3in1', { unit: 'dona' });
  const pairing = pairVersions([rice[0], sugar[0], salt[0], gone], [rice[1], sugar[1], salt[1], added]);

  it('counts new, removed, changed and unchanged rows and says what changed', () => {
    const parts = diffParts(pairing, {
      prevRisky: set(sugar[0].id), nextRisky: set(sugar[1].id), updated: set(),
      prevDecided: set(), nextPending: set(),
    }, 200);
    assert.deepEqual(parts.counts, { added: 1, removed: 1, changed: 1, unchanged: 2, statusChanged: 0, reReview: 0 });
    assert.deepEqual(parts.changed[0]?.notes, ['code']);
    assert.equal(parts.added[0]?.name, 'Kofe 3in1');
    assert.equal(parts.removed[0]?.name, 'Choy qora 100 g');
  });

  it('lists decisions that need another look: changed rows, and unchanged rows whose decision did not carry', () => {
    const parts = diffParts(pairing, {
      prevRisky: set(), nextRisky: set(salt[1].id), updated: set(),
      prevDecided: set(rice[0].id, sugar[0].id, salt[0].id), nextPending: set(sugar[1].id, salt[1].id),
    }, 200);
    assert.equal(parts.counts.reReview, 2);
    assert.deepEqual(parts.reReview.map((r) => r.notes), [['code'], undefined]);
    // The salt row became risky without changing.
    assert.deepEqual(parts.statusChanged.map((r) => r.notes), [['nowRisky']]);
  });

  it('caps the lists but not the counts', () => {
    const parts = diffParts(pairing, { prevRisky: set(), nextRisky: set(), updated: set(), prevDecided: set(), nextPending: set() }, 0);
    assert.equal(parts.added.length, 0);
    assert.equal(parts.counts.added, 1);
  });

  it('names barcode and unit changes', () => {
    assert.deepEqual(changedFields(item('Guruch', { barcode: '4780074540164' }), item('Guruch', { barcode: '4601501483581', unit: 'dona' })), ['unit', 'barcode']);
  });

  it('keeps the previous values and how the pair was made, so a change reads old to new', () => {
    const parts = diffParts(pairing, { prevRisky: set(), nextRisky: set(), updated: set(), prevDecided: set(), nextPending: set() }, 200);
    const row = parts.changed[0];
    assert.equal(row?.before?.code, '02202001001000000');
    assert.equal(row?.code, '01901001003000000');
    // Same words and unit, no barcode: paired by the exact name key.
    assert.equal(row?.match, 'name');
  });

  it('flags an approximate pairing: same position and words, but unit and code differ', () => {
    const a = item('Shakar oq', { unit: 'kg', rowIndex: 7 });
    const b = item('Shakar oq', { unit: 'dona', existingMxik: '01901001003000000', rowIndex: 7 });
    const approx = pairVersions([a], [b]);
    const parts = diffParts(approx, { prevRisky: set(), nextRisky: set(), updated: set(), prevDecided: set(), nextPending: set() }, 10);
    assert.equal(parts.changed[0]?.match, 'row');
    assert.deepEqual(parts.changed[0]?.notes, ['unit', 'code']);
  });

  it('pages a list by offset without changing the counts', () => {
    const many = pairVersions([], Array.from({ length: 5 }, (_, n) => item(`Yangi tovar ${n} 1 kg`)));
    const sets = { prevRisky: set(), nextRisky: set(), updated: set(), prevDecided: set(), nextPending: set() };
    assert.equal(diffParts(many, sets, 2, 0).added.length, 2);
    assert.equal(diffParts(many, sets, 2, 4).added.length, 1);
    assert.equal(diffParts(many, sets, 2, 4).counts.added, 5);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { batchConflicts, conflictingSibling, effectiveDecision, type ItemFinding } from './effective-code.js';

const f = (id: string, decision: ItemFinding['decision'], chosenMxik: string | null, decidedAt: string | null, type = 'MISMATCH'): ItemFinding =>
  ({ id, type, decision, chosenMxik, decidedAt });

describe('effectiveDecision', () => {
  it('takes the latest acceptance when a row holds two accepted codes', () => {
    const result = effectiveDecision([
      f('a', 'accepted', '11111111111111111', '2026-10-01T10:00:00Z'),
      f('b', 'accepted', '22222222222222222', '2026-10-02T10:00:00Z', 'UNIT_CONFLICT'),
    ]);
    assert.deepEqual(result, { state: 'accepted', code: '22222222222222222', findingId: 'b' });
  });

  it('does not depend on input order when times are equal', () => {
    const one = [f('a', 'accepted', '1', '2026-10-01T10:00:00Z'), f('b', 'accepted', '2', '2026-10-01T10:00:00Z')];
    assert.deepEqual(effectiveDecision(one), effectiveDecision([...one].reverse()));
  });

  it('an acceptance beats a later rejection; rejection alone is rejected; nothing decided is pending', () => {
    assert.equal(effectiveDecision([f('a', 'accepted', '1', '2026-10-01'), f('b', 'rejected', null, '2026-10-05')]).state, 'accepted');
    assert.deepEqual(effectiveDecision([f('a', 'rejected', null, '2026-10-01'), f('b', 'pending', null, null)]), { state: 'rejected', findingId: 'a' });
    assert.deepEqual(effectiveDecision([f('a', 'pending', null, null)]), { state: 'pending' });
  });
});

describe('conflictingSibling', () => {
  it('blocks a different code accepted on another finding of the row', () => {
    const row = [f('a', 'accepted', '1', '2026-10-01'), f('b', 'pending', null, null)];
    assert.equal(conflictingSibling(row, 'b', '2')?.id, 'a');
  });

  it('allows the same code, rejections, and the finding itself', () => {
    const row = [f('a', 'accepted', '1', '2026-10-01'), f('c', 'rejected', null, '2026-10-01'), f('b', 'pending', null, null)];
    assert.equal(conflictingSibling(row, 'b', '1'), null);
    assert.equal(conflictingSibling(row, 'a', '9'), null);
  });
});

describe('batchConflicts', () => {
  it('skips rows that already hold another code and rows given two codes in one batch', () => {
    const targets = [
      { id: 'a', itemId: 'row1', code: '1' },
      { id: 'b', itemId: 'row2', code: '2' },
      { id: 'c', itemId: 'row2', code: '3' },
      { id: 'd', itemId: 'row3', code: '4' },
    ];
    const accepted = new Map([['row1', ['9']], ['row3', ['4']]]);
    assert.deepEqual([...batchConflicts(targets, accepted)].sort(), ['a', 'b', 'c']);
  });
});

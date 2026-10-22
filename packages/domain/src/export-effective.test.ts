import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveCode, effectiveRow, type EffectiveFinding } from './export-effective.js';

const at = (iso: string): Date => new Date(iso);
const f = (decision: string, chosenMxik: string | null = null, decidedAt: Date | null = null, severity = 'high'): EffectiveFinding =>
  ({ severity, decision, chosenMxik, decidedAt });

const FILE = '00000000000000001';
const A = '11111111111111111';
const B = '22222222222222222';

describe('effective code per row', () => {
  it('keeps the file code and says "ok" when nothing risky was found', () => {
    assert.deepEqual(effectiveRow(FILE, []), { code: FILE, acceptedCode: null, review: 'ok' });
    assert.equal(effectiveRow(FILE, [f('pending', null, null, 'info')]).review, 'ok');
  });

  it('uses the latest accepted decision among sibling findings', () => {
    const row = effectiveRow(FILE, [f('accepted', A, at('2026-10-01')), f('accepted', B, at('2026-10-02'))]);
    assert.equal(row.code, B);
    assert.equal(row.review, 'accepted');
    assert.equal(effectiveCode(FILE, [f('accepted', B, at('2026-10-02')), f('accepted', A, at('2026-10-01'))]), B);
  });

  it('never exports a row with a pending sibling as clean', () => {
    const partial = effectiveRow(FILE, [f('accepted', A, at('2026-10-01')), f('pending')]);
    assert.equal(partial.review, 'partial');
    assert.equal(partial.code, A);
    const open = effectiveRow(FILE, [f('pending'), f('pending', null, null, 'medium')]);
    assert.equal(open.review, 'pending');
    assert.equal(open.code, FILE);
  });

  it('rejected everywhere keeps the file code', () => {
    const row = effectiveRow(FILE, [f('rejected', null, at('2026-10-01'))]);
    assert.deepEqual(row, { code: FILE, acceptedCode: null, review: 'rejected' });
  });

  it('an accepted informational finding still changes the code', () => {
    const row = effectiveRow(null, [f('accepted', A, at('2026-10-01'), 'info')]);
    assert.equal(row.code, A);
    assert.equal(row.review, 'ok');
  });
});

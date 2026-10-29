import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { accepts, parseCases } from './cases.js';

// The 22 queries of the 28 Oct comparison with tasnif.krafta.uz (docs/BENCHMARK_KRAFTA.md).
describe('competitor-22.csv', () => {
  const { cases, errors } = parseCases(readFileSync('eval/competitor-22.csv', 'utf8'), 'competitor-22.csv');

  it('loads all 22 queries as real cases without a bad row', () => {
    assert.deepEqual(errors, []);
    assert.equal(cases.length, 22);
    assert.ok(cases.every((c) => c.source === 'real'));
    assert.equal(new Set(cases.map((c) => c.name)).size, 22);
  });

  it('records the competitor result per row, and it agrees with the label', () => {
    let hits = 0;
    for (const c of cases) {
      const krafta = /Krafta top-1 = (?:MISS \((\d{17})|(\d{17}))/.exec(c.notes);
      assert.ok(krafta, `${c.name}: no Krafta top-1 in the notes`);
      const code = krafta[1] ?? krafta[2] ?? '';
      const missed = krafta[1] !== undefined;
      assert.equal(accepts(c.correct, code), !missed, `${c.name}: note says ${missed ? 'MISS' : 'hit'} for ${code}`);
      if (!missed) hits++;
    }
    // 18/22 on 28 Oct with golden's exact cement label; §4's 02523002* label makes the cement row a hit.
    assert.equal(hits, 19);
  });
});

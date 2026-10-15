import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { APOSTROPHES, makeRng, noisify } from './noise.js';

describe('noisify', () => {
  it('is deterministic for a seed', () => {
    const a = noisify("Yog'och taxta", makeRng(7));
    const b = noisify("Yog'och taxta", makeRng(7));
    assert.deepEqual(a, b);
  });

  it('always changes the name', () => {
    const rng = makeRng(1);
    for (let i = 0; i < 200; i++) {
      const out = noisify('KARTOSHKA', rng);
      assert.notEqual(out.name, 'KARTOSHKA');
      assert.ok(out.applied.length > 0);
    }
  });

  it('covers all seven apostrophe variants over many draws', () => {
    const rng = makeRng(42);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      for (const ch of noisify("no'xat go'sht", rng).name) if ((APOSTROPHES as readonly string[]).includes(ch)) seen.add(ch);
    }
    assert.equal(seen.size, 7);
  });

  it('produces every transform kind over many draws', () => {
    const rng = makeRng(3);
    const kinds = new Set<string>();
    for (let i = 0; i < 300; i++) for (const t of noisify("Shakar-rafinad qadoqlangan o'ramda", rng).applied) kinds.add(t);
    assert.deepEqual([...kinds].sort(), ['apostrophe', 'brand', 'case', 'mixed-script', 'pack', 'typo']);
  });
});

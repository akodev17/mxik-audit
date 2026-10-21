import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diagnoseMiss } from './diagnose.js';

describe('diagnoseMiss', () => {
  it('separates shared words, inflected forms and words the code never uses', () => {
    const d = diagnoseMiss(
      ['armatura', 'a500s', '12'],
      ['prokat', 'armaturniy', 'armaturali'],
    );
    assert.deepEqual(d.shared, []);
    assert.deepEqual(d.inflection, ['armatura~armaturniy']);
    assert.deepEqual(d.queryOnly, ['a500s']);
  });

  it('ignores numbers and fragments, and reports each query word once', () => {
    const d = diagnoseMiss(['blok', 'blok', 'fbs', '24', 'b'], ['bloki', 'blok', 'fundamentniy']);
    assert.deepEqual(d.shared, ['blok']);
    assert.deepEqual(d.queryOnly, ['fbs']);
    assert.deepEqual(d.inflection, []);
  });

  it('needs five common letters before calling two words one inflected word', () => {
    assert.deepEqual(diagnoseMiss(['kirpich'], ['kirpichi']).inflection, ['kirpich~kirpichi']);
    assert.deepEqual(diagnoseMiss(['kraska'], ['kran']).queryOnly, ['kraska']);
  });
});

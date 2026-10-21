import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { holdoutIds } from './split.js';

const ids = (set: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${set}.csv:${i + 2}`);

describe('holdoutIds', () => {
  it('holds out ceil(20%) of every set on its own', () => {
    const all = [...ids('golden', 12), ...ids('real-metal', 168), ...ids('synthetic', 191)];
    const held = holdoutIds(all);
    const count = (set: string) => [...held].filter((id) => id.startsWith(`${set}.csv`)).length;
    assert.equal(count('golden'), 3);
    assert.equal(count('real-metal'), 34);
    assert.equal(count('synthetic'), 39);
  });

  it('is deterministic and independent of input order', () => {
    const all = ids('real-construction', 102);
    assert.deepEqual([...holdoutIds(all)].sort(), [...holdoutIds([...all].reverse())].sort());
  });

  it('does not pick the first rows of a file', () => {
    const held = holdoutIds(ids('real-metal', 168));
    assert.ok([...held].some((id) => Number(id.split(':')[1]) > 100));
  });
});

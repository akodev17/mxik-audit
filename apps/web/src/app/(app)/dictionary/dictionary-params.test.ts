import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readDictParams } from './dictionary-params.js';

describe('dictionary URL', () => {
  // The filter itself is held to the domain's in tests/web-parity.
  it('trims the search and reads the page number leniently', () => {
    assert.deepEqual(readDictParams({ q: '  sut ', page: '2', f: 'stale' }), { q: 'sut', page: 2, filter: 'stale' });
    assert.deepEqual(readDictParams({ q: 'a'.repeat(90), page: '-3' }), { q: 'a'.repeat(80), page: 0, filter: 'all' });
    assert.equal(readDictParams({ page: '1.7' }).page, 1);
    assert.equal(readDictParams({ page: 'abc' }).page, 0);
    assert.equal(readDictParams({ page: '1e400' }).page, 0);
  });
});

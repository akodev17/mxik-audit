import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as domain from '@tasnivo/domain/dictionary-review';
import { DICT_FILTERS, parseDictFilter, readDictParams } from './dictionary-params.js';

describe('dictionary URL', () => {
  it('reads the filter as the domain does', () => {
    assert.deepEqual([...DICT_FILTERS], [...domain.DICT_FILTERS]);
    for (const f of [undefined, '', 'all', 'confirmed', 'unverified', 'stale', 'STALE', 'x']) assert.equal(parseDictFilter(f), domain.parseDictFilter(f));
  });

  it('trims the search and reads the page number leniently', () => {
    assert.deepEqual(readDictParams({ q: '  sut ', page: '2', f: 'stale' }), { q: 'sut', page: 2, filter: 'stale' });
    assert.deepEqual(readDictParams({ q: 'a'.repeat(90), page: '-3' }), { q: 'a'.repeat(80), page: 0, filter: 'all' });
    assert.equal(readDictParams({ page: '1.7' }).page, 1);
    assert.equal(readDictParams({ page: 'abc' }).page, 0);
    assert.equal(readDictParams({ page: '1e400' }).page, 0);
  });
});

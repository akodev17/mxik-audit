import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { columnKinds } from './preview-columns';

describe('columnKinds', () => {
  it('tells codes, numbers, text and empty columns apart', () => {
    const rows = [
      ['Sut 1 L', '04001001001001001', '12 500', '', 'dona'],
      ['Non', '4001001001001001', '3500,5', ' ', '12'],
    ];
    assert.deepEqual(columnKinds(5, rows), ['text', 'code', 'number', 'empty', 'text']);
  });

  it('reads a missing cell as empty and a header with no rows as empty', () => {
    assert.deepEqual(columnKinds(2, [['1']]), ['number', 'empty']);
    assert.deepEqual(columnKinds(1, []), ['empty']);
  });

  it('does not take a short digit run for a code', () => {
    assert.deepEqual(columnKinds(1, [['123456']]), ['number']);
  });
});

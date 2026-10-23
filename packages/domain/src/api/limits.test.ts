// Q1: the per-process cap on /api/v1/check runs in flight.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkConcurrency, checksInFlight, startCheck } from './limits';

describe('check concurrency cap (Q1)', () => {
  it('defaults to 4, reads API_CHECK_CONCURRENCY, never below 1', () => {
    assert.equal(checkConcurrency({}), 4);
    assert.equal(checkConcurrency({ API_CHECK_CONCURRENCY: '2' }), 2);
    assert.equal(checkConcurrency({ API_CHECK_CONCURRENCY: '0' }), 1);
    assert.equal(checkConcurrency({ API_CHECK_CONCURRENCY: 'many' }), 4);
  });

  it('refuses a slot once the limit is running and frees it on release, once', () => {
    const before = checksInFlight();
    const limit = before + 2;
    const first = startCheck(limit);
    const second = startCheck(limit);
    assert.ok(first && second);
    assert.equal(startCheck(limit), null);
    first();
    first(); // a second release of the same slot changes nothing
    assert.equal(checksInFlight(), before + 1);
    const third = startCheck(limit);
    assert.ok(third);
    assert.equal(startCheck(limit), null);
    second();
    third();
    assert.equal(checksInFlight(), before);
  });
});

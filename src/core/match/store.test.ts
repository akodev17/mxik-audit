import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { isTransient, PostgresCandidateStore, storeRetryCount } from './store.js';

/** A pool whose query() fails with the given errors, in order, then answers. */
function flakyPool(errors: unknown[]): { pool: Pool; calls: () => number } {
  let calls = 0;
  const pool = {
    query: () => {
      calls++;
      const next = errors.shift();
      return next ? Promise.reject(next) : Promise.resolve({ rows: [{ retiredAt: null }] });
    },
  } as unknown as Pool;
  return { pool, calls: () => calls };
}

describe('PostgresCandidateStore retries', () => {
  it('runs a read again once after a dropped connection', async () => {
    const before = storeRetryCount();
    const { pool, calls } = flakyPool([Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })]);
    const result = await new PostgresCandidateStore(pool).exists('01701001002000000');
    assert.deepEqual(result, { found: true, retired: false });
    assert.equal(calls(), 2);
    assert.equal(storeRetryCount(), before + 1);
  });

  it('does not retry a real query error', async () => {
    const { pool, calls } = flakyPool([Object.assign(new Error('syntax error'), { code: '42601' })]);
    await assert.rejects(new PostgresCandidateStore(pool).exists('01701001002000000'), /syntax error/);
    assert.equal(calls(), 1);
  });

  it('gives up after one retry', async () => {
    const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const { pool, calls } = flakyPool([reset(), reset()]);
    await assert.rejects(new PostgresCandidateStore(pool).exists('01701001002000000'), /ECONNRESET/);
    assert.equal(calls(), 2);
  });

  it('knows which failures are transient', () => {
    assert.equal(isTransient({ code: 'ECONNRESET' }), true);
    assert.equal(isTransient({ code: '57P01' }), true);
    assert.equal(isTransient({ code: '23505' }), false);
    assert.equal(isTransient(new Error('x')), false);
  });
});

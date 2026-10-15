import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Pool } from 'pg';
import { isTransient, PostgresCandidateStore, storeRetryCount } from './store.js';

/** A pool whose query() fails with the given errors, in order, then answers. */
function flakyPool(errors: Error[]): { pool: Pool; calls: () => number } {
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

/** A pool that answers the term-statistics query and records full-text queries. */
function statsPool(stats: Record<string, number> | Error): { pool: Pool; searches: unknown[][]; statLoads: () => number } {
  const searches: unknown[][] = [];
  let statLoads = 0;
  const pool = {
    query: (sql: string, params: unknown[]) => {
      if (sql.includes('ts_stat')) {
        statLoads++;
        if (stats instanceof Error) return Promise.reject(stats);
        return Promise.resolve({ rows: Object.entries(stats).map(([word, ndoc]) => ({ word, ndoc })) });
      }
      searches.push(params);
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
  return { pool, searches, statLoads: () => statLoads };
}

describe('PostgresCandidateStore full-text term selection', () => {
  it('ranks on every term but selects candidates only on the rare ones', async () => {
    const { pool, searches } = statsPool({ uchun: 117_000, elektr: 26_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 }).byFullText('elektr choynak uchun', 50);
    assert.deepEqual(searches[0], ['elektr | choynak | uchun', 50, 'choynak']);
  });

  it('selects on every term when all of them are common', async () => {
    const { pool, searches } = statsPool({ uchun: 117_000, va: 94_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 }).byFullText('uchun va', 50);
    assert.deepEqual(searches[0], ['uchun | va', 50, 'uchun | va']);
  });

  it('skips the statistics entirely when the cutoff is off', async () => {
    const { pool, searches, statLoads } = statsPool({ uchun: 117_000 });
    await new PostgresCandidateStore(pool, { fullTextCommonDocs: 0 }).byFullText('elektr uchun', 50);
    assert.deepEqual(searches[0], ['elektr | uchun', 50, 'elektr | uchun']);
    assert.equal(statLoads(), 0);
  });

  it('loads the statistics once per pool', async () => {
    const { pool, statLoads } = statsPool({ uchun: 117_000 });
    await Promise.all([1, 2, 3].map(() => new PostgresCandidateStore(pool).byFullText('elektr uchun', 50)));
    assert.equal(statLoads(), 1);
  });

  it('falls back to every term when the statistics fail, and retries later', async () => {
    const { pool, searches, statLoads } = statsPool(new Error('canceling statement'));
    const store = new PostgresCandidateStore(pool, { fullTextCommonDocs: 10_000 });
    await store.byFullText('elektr uchun', 50);
    await store.byFullText('elektr uchun', 50);
    assert.deepEqual(searches[0], ['elektr | uchun', 50, 'elektr | uchun']);
    assert.equal(statLoads(), 2);
  });
});

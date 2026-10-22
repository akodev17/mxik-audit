// ClassifierSearchService without a database: 503 classifier_unavailable while the classifier
// cannot be queried or holds no live code, and a fresh attempt on the next request after a failure.
import '../setup-env';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { Logger } from '@nestjs/common';
import type { PgPoolService } from '../../src/db/pg-pool.service';
import { ApiError } from '../../src/http/errors';
import { ClassifierSearchService } from '../../src/workspace/classifier-search.service';

/** A pool whose queries answer `rowCount` (or throw), counting the calls. */
function fakePool(answer: { rowCount: number } | Error) {
  const calls = { n: 0 };
  const pool = {
    query: (): Promise<{ rowCount: number; rows: unknown[] }> => {
      calls.n += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ rowCount: answer.rowCount, rows: [] });
    },
  };
  return { service: { pool } as unknown as PgPoolService, calls };
}

const unavailable = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 503 && error.code === 'classifier_unavailable';

describe('ClassifierSearchService', () => {
  before(() => { Logger.overrideLogger(false); });
  it('503 classifier_unavailable when the classifier tables cannot be read', async () => {
    const { service, calls } = fakePool(new Error('relation "mxik_code" does not exist'));
    const search = new ClassifierSearchService(service);
    await assert.rejects(search.search('sut', 10), unavailable);
    // Not kept: the next request sets up again.
    await assert.rejects(search.search('sut', 10), unavailable);
    assert.equal(calls.n, 2);
  });

  it('503 while no live code is loaded', async () => {
    const { service } = fakePool({ rowCount: 0 });
    await assert.rejects(new ClassifierSearchService(service).search('sut', 10), unavailable);
  });
});

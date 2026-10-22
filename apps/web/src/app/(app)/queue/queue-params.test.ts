import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as domainQueue from '@tasnivo/domain/queue';
import { withQuery as domainWithQuery } from '@tasnivo/domain/query-string';
import { QUEUE_DUE, queueQuery, readQueueFilter, workspaceHref, withQuery } from './queue-params.js';

describe('queue URL (web copies of the domain)', () => {
  it('reads filters as the domain does', () => {
    assert.deepEqual([...QUEUE_DUE], [...domainQueue.QUEUE_DUE]);
    const samples = [
      {}, { client: 'c1', type: 'MISMATCH', severity: 'high', flag: 'ask_client', accountant: 'u1', due: 'week' },
      { client: '', type: 'x', severity: 'low', flag: 'resolved', accountant: '', due: 'year' }, { type: 'RESTRICTED', severity: 'medium', due: 'overdue' },
    ];
    for (const p of samples) assert.deepEqual(readQueueFilter(p), domainQueue.readQueueFilter(p));
  });

  it('builds the API query from the filter', () => {
    assert.deepEqual(queueQuery(readQueueFilter({}), undefined), {});
    assert.deepEqual(
      queueQuery(readQueueFilter({ client: 'c1', type: 'MISMATCH', severity: 'high', flag: 'ask_client', accountant: 'u1', due: 'week' }), 'abc'),
      { client: 'c1', type: 'MISMATCH', severity: 'high', flag: 'ask_client', accountant: 'u1', due: 'week', cursor: 'abc' },
    );
    assert.equal(queueQuery(readQueueFilter({ client: 'x'.repeat(80) }), 'y'.repeat(500)).cursor?.length, 400);
  });

  it('links rows and keeps filters as the domain does', () => {
    const row = { catalogId: 'cat', rawName: `Sut 1 l & "${'x'.repeat(120)}"`, findingId: 'f1' };
    assert.equal(workspaceHref(row), domainQueue.workspaceHref(row));
    const current = { client: 'c1', type: 'MISMATCH', after: undefined, due: ['week', 'month'] };
    assert.equal(withQuery('/queue', current), domainWithQuery('/queue', current));
    assert.equal(withQuery('/queue', current, { client: null, after: 'z' }), domainWithQuery('/queue', current, { client: null, after: 'z' }));
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { queueQuery, readQueueFilter } from './queue-params.js';

// readQueueFilter, workspaceHref and withQuery are held to the domain's in tests/web-parity.
describe('queue URL', () => {
  it('builds the API query from the filter', () => {
    assert.deepEqual(queueQuery(readQueueFilter({}), undefined), {});
    assert.deepEqual(
      queueQuery(readQueueFilter({ client: 'c1', type: 'MISMATCH', severity: 'high', flag: 'ask_client', accountant: 'u1', due: 'week' }), 'abc'),
      { client: 'c1', type: 'MISMATCH', severity: 'high', flag: 'ask_client', accountant: 'u1', due: 'week', cursor: 'abc' },
    );
    assert.equal(queueQuery(readQueueFilter({ client: 'x'.repeat(80) }), 'y'.repeat(500)).cursor?.length, 400);
  });
});

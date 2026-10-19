import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ViewParams, readHidden, viewQuery } from './view-params.js';
import { filterQuery, pendingSubset, readFilter } from './workspace-filter.js';

describe('workspace filter', () => {
  it('reads the defaults, the older pending=0 spelling and rejects unknown values', () => {
    assert.deepEqual(readFilter({}), { type: null, q: '', decision: 'pending', flag: 'any', commented: false, sort: 'risk' });
    assert.equal(readFilter({ pending: '0' }).decision, 'all');
    assert.equal(readFilter({ pending: '0', dec: 'carried' }).decision, 'carried');
    assert.equal(readFilter({ dec: 'everything', flag: 'maybe', type: 'DROP TABLE' }).decision, 'pending');
    assert.equal(readFilter({ flag: 'maybe' }).flag, 'any');
    assert.equal(readFilter({ type: 'DROP TABLE' }).type, null);
  });

  it('writes a filter back to the same query it was read from', () => {
    const f = readFilter({ type: 'MISMATCH', q: 'guruch', dec: 'auto', flag: 'none', comments: '1', sort: 'row' });
    assert.deepEqual(readFilter(filterQuery(f)), f);
    assert.deepEqual(filterQuery(readFilter({})), {});
  });

  it('decisions on a filter touch only its pending rows, and nothing when it shows decided rows only', () => {
    assert.equal(pendingSubset(readFilter({ dec: 'all' }))?.decision, 'pending');
    assert.equal(pendingSubset(readFilter({ dec: 'accepted' })), null);
  });
});

describe('saved view params', () => {
  it('opens views saved before decision, flag and column fields existed', () => {
    const old = ViewParams.parse({ type: null, q: '', pending: false, comments: false, sort: 'risk', density: 'compact', grouped: true });
    assert.equal(new URLSearchParams(viewQuery(old)).get('dec'), 'all');
  });

  it('carries decision, flag and hidden columns in the URL', () => {
    const view = ViewParams.parse({ type: 'MISSING', q: '', pending: true, decision: 'rejected', flag: 'ask_client', comments: false, sort: 'risk', density: 'comfortable', grouped: false, hidden: ['match', 'status'] });
    const q = new URLSearchParams(viewQuery(view));
    assert.equal(q.get('dec'), 'rejected');
    assert.equal(q.get('flag'), 'ask_client');
    assert.deepEqual(readHidden(q.get('cols')), ['status', 'match']);
    assert.deepEqual(readHidden('decision,product,match'), ['match']);
  });
});

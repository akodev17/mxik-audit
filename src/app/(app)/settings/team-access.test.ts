import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { draftError, draftOf, lastAdminLocked, sameAccess, widening } from './team-access';

describe('team access drafts', () => {
  it('no assigned clients reads as "all clients"; an admin is always all', () => {
    assert.deepEqual(draftOf({ role: 'viewer', clientIds: [] }), { role: 'viewer', access: 'all', clientIds: [] });
    assert.deepEqual(draftOf({ role: 'accountant', clientIds: ['a'] }), { role: 'accountant', access: 'selected', clientIds: ['a'] });
    assert.deepEqual(draftOf({ role: 'admin', clientIds: ['a'] }), { role: 'admin', access: 'all', clientIds: [] });
  });

  it('"selected" with no client cannot be saved: it would silently mean every client', () => {
    assert.equal(draftError({ role: 'viewer', access: 'selected', clientIds: [] }), 'no_clients');
    assert.equal(draftError({ role: 'viewer', access: 'selected', clientIds: ['a'] }), null);
    assert.equal(draftError({ role: 'viewer', access: 'all', clientIds: [] }), null);
    assert.equal(draftError({ role: 'admin', access: 'selected', clientIds: [] }), null);
  });

  it('a higher role, all clients or extra clients widen access', () => {
    const viewer = draftOf({ role: 'viewer', clientIds: ['a'] });
    assert.deepEqual(widening(viewer, { ...viewer, role: 'accountant' }), { role: 'accountant', allClients: false, addedClients: [] });
    assert.deepEqual(widening(viewer, { ...viewer, access: 'all', clientIds: [] }), { role: null, allClients: true, addedClients: [] });
    assert.deepEqual(widening(viewer, { ...viewer, clientIds: ['a', 'b'] }), { role: null, allClients: false, addedClients: ['b'] });
    assert.deepEqual(widening(viewer, { role: 'admin', access: 'all', clientIds: [] }), { role: 'admin', allClients: false, addedClients: [] });
  });

  it('narrowing or keeping access does not ask', () => {
    const accountant = draftOf({ role: 'accountant', clientIds: [] });
    assert.equal(widening(accountant, { role: 'viewer', access: 'all', clientIds: [] }), null);
    assert.equal(widening(accountant, { role: 'accountant', access: 'selected', clientIds: ['a'] }), null);
    const two = draftOf({ role: 'viewer', clientIds: ['a', 'b'] });
    assert.equal(widening(two, { ...two, clientIds: ['a'] }), null);
  });

  it('compares access regardless of client order', () => {
    const a = draftOf({ role: 'viewer', clientIds: ['a', 'b'] });
    assert.ok(sameAccess(a, { ...a, clientIds: ['b', 'a'] }));
    assert.ok(!sameAccess(a, { ...a, clientIds: ['a'] }));
    assert.ok(sameAccess(draftOf({ role: 'admin', clientIds: [] }), { role: 'admin', access: 'selected', clientIds: ['x'] }));
  });

  it('locks the role of the only admin', () => {
    assert.ok(lastAdminLocked({ role: 'admin' }, 1));
    assert.ok(!lastAdminLocked({ role: 'admin' }, 2));
    assert.ok(!lastAdminLocked({ role: 'accountant' }, 1));
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClientStats } from './client-stats.js';
import { arrangeQueue, issueShares, parseQueueParams, queueFilterCounts, workQueue } from './work-queue.js';

function client(over: Partial<ClientStats> & { id: string; name: string }): ClientStats {
  return {
    isDefault: false, archivedAt: null, createdAt: new Date(0), catalogId: 'k', catalogName: 'Katalog', auditedAt: new Date(0),
    rowCount: 100, previousId: null, catalogs: 1, riskyRows: 0, openRows: 0, riskyFindings: 0, pendingFindings: 0,
    updatePending: 0, overdueTasks: 0, accountants: [], ...over,
  };
}

describe('workQueue', () => {
  it('leaves out clients with nothing to do', () => {
    assert.deepEqual(workQueue([client({ id: 'a', name: 'A', riskyRows: 5 })], new Set()), []);
  });

  it('orders overdue checks first, then open rows, then the rest', () => {
    const q = workQueue([
      client({ id: 'a', name: 'A', openRows: 90 }),
      client({ id: 'b', name: 'B', openRows: 3, overdueTasks: 1 }),
      client({ id: 'c', name: 'C', catalogId: null, catalogs: 0 }),
      client({ id: 'd', name: 'D', openRows: 10 }),
    ], new Set());
    assert.deepEqual(q.map((e) => e.client.id), ['b', 'a', 'd', 'c']);
    assert.deepEqual(q.map((e) => e.tier), ['overdue', 'open', 'open', 'other']);
  });

  it('picks the action from what is wrong', () => {
    const q = workQueue([
      client({ id: 'a', name: 'A', openRows: 2 }),
      client({ id: 'b', name: 'B', overdueTasks: 1 }),
      client({ id: 'c', name: 'C', catalogId: null, catalogs: 0 }),
      client({ id: 'd', name: 'D', catalogId: null, catalogs: 1 }),
    ], new Set(['d']));
    const by = Object.fromEntries(q.map((e) => [e.client.id, e.action]));
    assert.deepEqual(by, { a: 'review', b: 'client', c: 'upload', d: 'client' });
  });

  it('does not flag the default client for having no catalogue', () => {
    assert.deepEqual(workQueue([client({ id: 'a', name: 'A', isDefault: true, catalogId: null })], new Set()), []);
  });
});

describe('issueShares', () => {
  it('gives shares of the total that sum to one', () => {
    const s = issueShares([{ type: 'x', findings: 30, rows: 30 }, { type: 'y', findings: 10, rows: 8 }]);
    assert.equal(s[0]?.share, 0.75);
    assert.equal(s.reduce((n, x) => n + x.share, 0), 1);
  });
  it('is all zero with no findings', () => {
    assert.deepEqual(issueShares([]), []);
  });
});

describe('queue filters and sorting', () => {
  const entries = workQueue([
    client({ id: 'a', name: 'Alfa', openRows: 5, auditedAt: new Date('2026-10-01') }),
    client({ id: 'b', name: 'Beta', openRows: 90, auditedAt: new Date('2026-09-01') }),
    client({ id: 'c', name: 'Gamma', overdueTasks: 2, auditedAt: new Date('2026-10-10') }),
    client({ id: 'd', name: 'Delta', catalogId: null, catalogs: 0, auditedAt: null }),
  ], new Set());

  it('parses unknown parameters to the defaults', () => {
    assert.deepEqual(parseQueueParams({ qf: 'x', qs: 3 }), { filter: 'all', sort: 'urgent' });
    assert.deepEqual(parseQueueParams({ qf: 'overdue', qs: 'name' }), { filter: 'overdue', sort: 'name' });
  });

  it('counts what each filter shows', () => {
    assert.deepEqual(queueFilterCounts(entries), { all: 4, overdue: 1, open: 2, setup: 1 });
  });

  it('filters', () => {
    assert.deepEqual(arrangeQueue(entries, 'overdue', 'urgent').map((e) => e.client.id), ['c']);
    assert.deepEqual(arrangeQueue(entries, 'open', 'urgent').map((e) => e.client.id), ['b', 'a']);
    assert.deepEqual(arrangeQueue(entries, 'setup', 'urgent').map((e) => e.client.id), ['d']);
  });

  it('sorts without changing the set', () => {
    assert.deepEqual(arrangeQueue(entries, 'all', 'name').map((e) => e.client.id), ['a', 'b', 'd', 'c']);
    assert.deepEqual(arrangeQueue(entries, 'all', 'open').map((e) => e.client.id), ['b', 'a', 'd', 'c']);
    assert.deepEqual(arrangeQueue(entries, 'all', 'audited').map((e) => e.client.id), ['d', 'b', 'a', 'c']);
  });
});

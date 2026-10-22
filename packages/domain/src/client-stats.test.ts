import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { attentionReasons, clientStats, rowProgress } from './client-stats.js';
import { dashboard, dashboardTotals } from './dashboard.js';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import { localDate } from './reminder-dates.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('client numbers and the dashboard (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let busy = '';
  let quiet = '';
  let old = '';

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    busy = await makeClient(a.orgId, 'Baraka');
    quiet = await makeClient(a.orgId, 'Quyosh');
    await makeClient(a.orgId, 'Yangi');
    old = await makeClient(a.orgId, 'Eski');
    // One row with two risky findings, one decided: 1 open row, 1 pending finding, 2 risky findings.
    // One row with an info finding only: never risky.
    await makeClientCatalog(a.orgId, busy, [
      { name: 'Guruch', findings: [{ severity: 'high' }, { type: 'UNIT_CONFLICT', severity: 'medium', decision: 'accepted' }] },
      { name: 'Shakar', findings: [{ severity: 'high', decision: 'rejected' }] },
      { name: 'Tuz', findings: [{ type: 'PRIVILEGE_CODE', severity: 'info' }] },
    ]);
    // Audited, nothing risky: zero total must read as a dash, not 100%.
    await makeClientCatalog(a.orgId, quiet, [{ name: 'Choy', findings: [{ type: 'PRIVILEGE_CODE', severity: 'info' }] }]);
    await makeClientCatalog(a.orgId, old, [{ name: 'Un', findings: [{ severity: 'high', decision: 'accepted' }] }], { createdAt: new Date(Date.now() - 45 * 86_400_000) });
    await makeClientCatalog(b.orgId, await makeClient(b.orgId, 'Begona'), [{ name: 'Yog', findings: [{ severity: 'high' }] }]);
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  const byName = async (filter: Parameters<typeof clientStats>[0]['filter'] = 'all', clientIds: string[] | null = null, search?: string) =>
    new Map((await clientStats({ orgId: a.orgId, clientIds, filter, search, limit: 100 })).rows.map((c) => [c.name, c]));

  it('counts open risky rows (distinct items) separately from pending findings', async () => {
    const stats = await byName();
    const c = stats.get('Baraka');
    assert.ok(c);
    assert.equal(c.riskyRows, 2);
    assert.equal(c.openRows, 1);
    assert.equal(c.riskyFindings, 3);
    assert.equal(c.pendingFindings, 1);
    assert.deepEqual(rowProgress(c), { done: 1, total: 2 });
  });

  it('shows no progress (not 100%) when there is nothing risky', async () => {
    const c = (await byName()).get('Quyosh');
    assert.ok(c);
    assert.equal(c.riskyRows, 0);
    assert.equal(rowProgress(c), null);
    assert.deepEqual(attentionReasons(c), []);
  });

  it('never flags the default client just for having no catalogue', async () => {
    const stats = await clientStats({ orgId: a.orgId, clientIds: null, filter: 'all', limit: 100 });
    const fallback = stats.rows.find((c) => c.isDefault);
    if (fallback && !fallback.catalogId) assert.deepEqual(attentionReasons(fallback), []);
    assert.deepEqual(attentionReasons(stats.rows.find((c) => c.name === 'Yangi') ?? assert.fail('missing')).map((r) => r.kind), ['empty']);
  });

  it('filters: attention, empty, stale, overdue, archived and search', async () => {
    assert.deepEqual([...(await byName('attention')).keys()].sort(), ['Baraka', 'Yangi']);
    assert.ok((await byName('empty')).has('Yangi'));
    assert.ok(!(await byName('empty')).has('Baraka'));
    assert.deepEqual([...(await byName('stale')).keys()], ['Eski']);
    assert.deepEqual([...(await byName('all', null, 'bar')).keys()], ['Baraka']);

    const { period, date } = localDate(new Date());
    await db.reminderTask.create({ data: { orgId: a.orgId, clientId: quiet, period, dueOn: new Date(date.getTime() - 2 * 86_400_000) } });
    assert.deepEqual([...(await byName('overdue')).keys()], ['Quyosh']);
    assert.ok((await byName('attention')).has('Quyosh'));

    const gone = await makeClient(a.orgId, 'Arxiv', { archived: true });
    assert.ok(!(await byName('all')).has('Arxiv'));
    assert.deepEqual([...(await byName('archived')).keys()], ['Arxiv']);
    const page = await clientStats({ orgId: a.orgId, clientIds: null, filter: 'all', limit: 100 });
    assert.equal(page.counts.archived, 1);
    assert.equal(page.counts.overdue, 1);
    await db.client.delete({ where: { id: gone } });
    await db.reminderTask.deleteMany({ where: { clientId: quiet } });
  });

  it('keeps to the org and to the caller’s clients', async () => {
    const all = await byName();
    assert.ok(!all.has('Begona'));
    const scoped = await byName('all', [busy]);
    assert.deepEqual([...scoped.keys()], ['Baraka']);
  });

  it('dashboard totals add rows and findings without mixing them', async () => {
    const stats = (await clientStats({ orgId: a.orgId, clientIds: null, filter: 'all', limit: 100 })).rows;
    const totals = dashboardTotals(stats);
    assert.equal(totals.openRows, 1);
    assert.equal(totals.pendingFindings, 1);
    assert.equal(totals.riskyRows, 3);
    assert.equal(totals.noCatalog, 1);
    assert.deepEqual(rowProgress(totals), { done: 2, total: 3 });
    assert.equal(rowProgress(dashboardTotals([])), null);
  });

  it('the accountant filter narrows to assigned clients; an unassigned accountant means every client', async () => {
    const admin = await makePerson(a.orgId, 'admin');
    const assigned = await makePerson(a.orgId, 'accountant', [busy]);
    const open = await makePerson(a.orgId, 'accountant');
    const narrowed = await dashboard(admin, assigned.userId);
    assert.deepEqual(narrowed.clients.map((c) => c.name), ['Baraka']);
    assert.equal(narrowed.selected?.assigned, 1);
    const everyone = await dashboard(admin, open.userId);
    assert.ok(everyone.clients.length >= 4);
    assert.equal(everyone.selected?.assigned, 0);
    assert.ok(!narrowed.accountants.some((p) => p.id === admin.userId), 'admins are not in the accountant filter');
    const row = narrowed.workload?.find((w) => w.userId === assigned.userId);
    assert.equal(row?.openRows, 1);
    assert.equal(row?.assigned, 1);
    assert.equal(narrowed.workload?.find((w) => w.userId === open.userId)?.assigned, null);

    // A scoped accountant sees their own clients only and gets no workload table.
    const own = await dashboard({ orgId: a.orgId, role: 'accountant', clientIds: [busy] }, null);
    assert.deepEqual(own.clients.map((c) => c.name), ['Baraka']);
    assert.equal(own.workload, null);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import { decodeQueueCursor, queuePage, readQueueFilter, unitFixOf, workspaceHref, type QueueFilter } from './queue.js';
import { localDate } from './reminder-dates.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

const none: QueueFilter = { clientId: null, type: null, severity: null, askClient: false, accountantId: null, due: null };

describe('review queue (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let baraka = '';
  let quyosh = '';
  let archived = '';

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    baraka = await makeClient(a.orgId, 'Baraka');
    quyosh = await makeClient(a.orgId, 'Quyosh');
    archived = await makeClient(a.orgId, 'Arxiv', { archived: true });
    // An older version: its findings must not show, only the latest audited catalogue counts.
    await makeClientCatalog(a.orgId, baraka, [{ name: 'Eski qator', findings: [{ severity: 'high' }] }], { createdAt: new Date(Date.now() - 86_400_000) });
    await makeClientCatalog(a.orgId, baraka, [
      { name: 'Guruch', findings: [{ severity: 'high' }, { type: 'UNIT_CONFLICT', severity: 'medium' }] },
      { name: 'Shakar', findings: [{ severity: 'medium', flag: 'ask_client' }] },
      { name: 'Tuz', findings: [{ severity: 'high', decision: 'accepted' }] },
      { name: 'Choy', findings: [{ type: 'PRIVILEGE_CODE', severity: 'info' }] },
    ]);
    // Not audited yet: nothing from it may appear.
    await makeClientCatalog(a.orgId, quyosh, [{ name: 'Yangi', findings: [{ severity: 'high' }] }], { status: 'uploaded' });
    await makeClientCatalog(a.orgId, quyosh, [{ name: 'Un', findings: [{ severity: 'high' }] }], { createdAt: new Date(Date.now() - 3_600_000) });
    await makeClientCatalog(a.orgId, archived, [{ name: 'Yashirin', findings: [{ severity: 'high' }] }]);
    await makeClientCatalog(b.orgId, await makeClient(b.orgId, 'Begona'), [{ name: 'Yog', findings: [{ severity: 'high' }] }]);
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  const names = (rows: { rawName: string }[]): string[] => rows.map((r) => r.rawName);

  it('lists pending high and medium findings of each visible client’s latest audited catalogue, high first', async () => {
    const page = await queuePage({ orgId: a.orgId, clientIds: null }, none, null);
    assert.deepEqual(names(page.rows), ['Guruch', 'Un', 'Guruch', 'Shakar']);
    assert.equal(page.total, 4);
    assert.deepEqual(page.byClient.map((c) => [c.name, c.findings, c.rows]), [['Baraka', 3, 2], ['Quyosh', 1, 1]]);
  });

  it('a scoped accountant sees only their clients, and a client filter cannot reach past that', async () => {
    const accountant = await makePerson(a.orgId, 'accountant', [quyosh]);
    const mine = await queuePage(accountant, none, null);
    assert.deepEqual(names(mine.rows), ['Un']);
    assert.deepEqual(mine.byClient.map((c) => c.clientId), [quyosh]);
    const sneaky = await queuePage(accountant, { ...none, clientId: baraka }, null);
    assert.deepEqual(sneaky.rows, []);
    assert.equal(sneaky.total, 0);
  });

  it('never shows another org’s or an archived client’s findings', async () => {
    const other = await queuePage({ orgId: b.orgId, clientIds: null }, none, null);
    assert.deepEqual(names(other.rows), ['Yog']);
    const forArchived = await queuePage({ orgId: a.orgId, clientIds: null }, { ...none, clientId: archived }, null);
    assert.deepEqual(forArchived.rows, []);
    const crossOrg = await queuePage({ orgId: b.orgId, clientIds: null }, { ...none, clientId: baraka }, null);
    assert.deepEqual(crossOrg.rows, []);
  });

  it('filters by type, severity, ask-client flag, accountant and due date', async () => {
    const viewer = { orgId: a.orgId, clientIds: null };
    assert.deepEqual(names((await queuePage(viewer, { ...none, type: 'UNIT_CONFLICT' }, null)).rows), ['Guruch']);
    assert.deepEqual(names((await queuePage(viewer, { ...none, severity: 'medium' }, null)).rows), ['Guruch', 'Shakar']);
    assert.deepEqual(names((await queuePage(viewer, { ...none, askClient: true }, null)).rows), ['Shakar']);

    const onBaraka = await makePerson(a.orgId, 'accountant', [baraka]);
    const everywhere = await makePerson(a.orgId, 'accountant');
    assert.equal((await queuePage(viewer, { ...none, accountantId: onBaraka.userId }, null)).total, 3);
    assert.equal((await queuePage(viewer, { ...none, accountantId: everywhere.userId }, null)).total, 4);

    assert.equal((await queuePage(viewer, { ...none, due: 'overdue' }, null)).total, 0);
    const { period, date } = localDate(new Date());
    await db.reminderTask.create({ data: { orgId: a.orgId, clientId: quyosh, period, dueOn: new Date(date.getTime() - 86_400_000) } });
    assert.deepEqual(names((await queuePage(viewer, { ...none, due: 'overdue' }, null)).rows), ['Un']);
  });

  it('pages with a keyset cursor, without gaps or repeats', async () => {
    const viewer = { orgId: a.orgId, clientIds: null };
    const seen: string[] = [];
    let cursor = null;
    for (let i = 0; i < 10; i += 1) {
      const page = await queuePage(viewer, none, cursor, { limit: 1 });
      seen.push(...page.rows.map((r) => r.findingId));
      if (!page.next) break;
      cursor = decodeQueueCursor(page.next);
      assert.ok(cursor);
    }
    const all = await queuePage(viewer, none, null);
    assert.deepEqual(seen, all.rows.map((r) => r.findingId));
  });

  it('reads filters from the URL and links each row to its workspace row', () => {
    assert.deepEqual(readQueueFilter({ type: 'MISSING', severity: 'low', flag: 'ask_client', due: 'week' }), { ...none, type: 'MISSING', askClient: true, due: 'week' });
    assert.equal(decodeQueueCursor('not-a-cursor'), null);
    const href = workspaceHref({ catalogId: 'c1', rawName: 'Guruch 1 kg', findingId: 'f1' });
    assert.equal(href, '/catalogs/c1?q=Guruch+1+kg&row=f1');
  });
});

describe('unit findings in the queue', () => {
  it('names the unit the code requires instead of repeating the code', () => {
    assert.deepEqual(unitFixOf('dona', ['кг']), { current: 'dona', expected: 'kilogramm' });
    assert.deepEqual(unitFixOf('  ', ['kilogramm']), { current: null, expected: 'kilogramm' });
  });

  it('keeps an unknown unit as written and gives nothing without one', () => {
    assert.deepEqual(unitFixOf('dona', ['qadoq-x']), { current: 'dona', expected: 'qadoq-x' });
    assert.equal(unitFixOf('dona', []), null);
    assert.equal(unitFixOf('dona', null), null);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import { activityPage, tashkentDayStart, type ActivityFilter } from './activity.js';
import { deleteCatalog } from './catalogs.js';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

const all: ActivityFilter = { clientId: null, userId: null, category: 'all', from: null, to: null, page: 0 };

describe('activity log scoping (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let admin: Person;
  let mine = '';
  let theirs = '';
  let catalogId = '';

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    admin = await makePerson(a.orgId, 'admin');
    mine = await makeClient(a.orgId, 'Meniki');
    theirs = await makeClient(a.orgId, 'Boshqaniki');
    ({ catalogId } = await makeClientCatalog(a.orgId, mine, [{ name: 'Guruch', findings: [{ severity: 'high' }] }], { filename: 'baraka.xlsx' }));
    const ev = (action: string, payload: Prisma.InputJsonObject, actorId: string | null = admin.userId, orgId = a.orgId) =>
      db.auditEvent.create({ data: { orgId, actorId, action, targetId: null, payload } });
    await ev('finding.accepted', { catalogId, productName: 'Guruch' });
    await ev('schedule.set', { clientId: theirs });
    await ev('client.created', { clientId: mine, name: 'Meniki' });
    await ev('team.invited', {});
    await ev('finding.accepted', { catalogId: 'elsewhere' }, null, b.orgId);
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('fills the client for events that are not about a catalogue', async () => {
    const { rows } = await activityPage(admin, all);
    const schedule = rows.find((r) => r.action === 'schedule.set');
    assert.equal(schedule?.clientName, 'Boshqaniki');
    const decided = rows.find((r) => r.action === 'finding.accepted');
    assert.equal(decided?.clientName, 'Meniki');
    assert.equal(decided?.catalogName, 'baraka.xlsx');
    assert.equal(decided?.product, 'Guruch');
  });

  it('a scoped accountant sees only their clients’ events and no org-level ones', async () => {
    const accountant = await makePerson(a.orgId, 'accountant', [mine]);
    const { rows } = await activityPage(accountant, all);
    const actions = rows.map((r) => r.action).sort();
    assert.deepEqual(actions, ['client.created', 'finding.accepted']);
    const sneaky = await activityPage(accountant, { ...all, clientId: theirs });
    assert.deepEqual(sneaky.rows, []);
  });

  it('an unrestricted accountant sees every client but not team events of others', async () => {
    const accountant = await makePerson(a.orgId, 'accountant');
    const { rows } = await activityPage(accountant, all, { withTotal: true });
    assert.ok(!rows.some((r) => r.action === 'team.invited'));
    assert.ok(rows.some((r) => r.action === 'schedule.set'));
    assert.ok((await activityPage(admin, all)).rows.some((r) => r.action === 'team.invited'));
  });

  it('never shows another org’s events', async () => {
    const { rows, total } = await activityPage(admin, all, { withTotal: true });
    assert.ok(!rows.some((r) => r.catalogId === 'elsewhere'));
    assert.equal(total, rows.length);
  });

  it('keeps a deleted catalogue’s events, named from its tombstone, for the people who saw them', async () => {
    assert.ok((await deleteCatalog(admin, catalogId)).ok);
    const accountant = await makePerson(a.orgId, 'accountant', [mine]);
    const { rows } = await activityPage(accountant, all);
    const decided = rows.find((r) => r.action === 'finding.accepted');
    assert.ok(decided, 'the decision stays in the log');
    assert.equal(decided.catalogDeleted, true);
    assert.equal(decided.catalogId, null);
    assert.equal(decided.catalogName, 'baraka.xlsx');
    assert.equal(decided.clientName, 'Meniki');
    assert.ok(rows.some((r) => r.action === 'catalog.deleted'));
  });

  it('B19: an upload never confirmed reads "file read" and stays out of the summaries; a one-row undo names its product', async () => {
    const org = await makeOrg();
    const boss = await makePerson(org.orgId, 'admin');
    const client = await makeClient(org.orgId, 'Mijoz');
    const draft = (await makeClientCatalog(org.orgId, client, [{ name: 'Non', findings: [] }], { status: 'uploaded' })).catalogId;
    const real = (await makeClientCatalog(org.orgId, client, [{ name: 'Sut', findings: [] }])).catalogId;
    const ev = (action: string, targetId: string | null, payload: Prisma.InputJsonObject) =>
      db.auditEvent.create({ data: { orgId: org.orgId, actorId: boss.userId, action, targetId, payload } });
    try {
      await ev('catalog.uploaded', draft, { clientId: client });
      await ev('catalog.uploaded', 'discarded-one', { clientId: client });
      await ev('catalog.upload_discarded', 'discarded-one', { catalogId: 'discarded-one', clientId: client });
      await ev('catalog.uploaded', real, { clientId: client });
      await ev('finding.undone', 'some-event', { catalogId: real, findings: [{ id: 'f1', productName: 'Sut' }] });

      const full = (await activityPage(boss, all)).rows;
      const byTarget = (action: string) => full.filter((r) => r.action === action).length;
      assert.equal(byTarget('catalog.previewed'), 2, 'the draft and the discarded upload');
      assert.equal(byTarget('catalog.uploaded'), 1, 'only the confirmed one');
      assert.equal(full.find((r) => r.action === 'finding.undone')?.product, 'Sut');

      const summary = (await activityPage(boss, all, { committedOnly: true })).rows.map((r) => r.action);
      assert.ok(!summary.includes('catalog.previewed') && !summary.includes('catalog.upload_discarded'), summary.join());
      assert.ok(summary.includes('catalog.uploaded'));
    } finally {
      await dropOrgs([org.orgId]);
    }
  });

  it('date filters use Tashkent calendar days', async () => {
    const start = tashkentDayStart('2026-10-19');
    assert.equal(start?.toISOString(), '2026-10-18T19:00:00.000Z');
    assert.equal(tashkentDayStart('2026-13-40'), null);
    assert.equal(tashkentDayStart('19.10.2026'), null);
    const future = await activityPage(admin, { ...all, from: '2999-01-01' });
    assert.deepEqual(future.rows, []);
  });
});

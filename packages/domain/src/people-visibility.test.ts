// Who a non-admin learns about the team (F20): the audit log's member picker lists every member for
// an admin and only the people behind events the reader may see for anyone else; a client page tells
// a non-admin nobody's other client assignments.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { activityView } from './activity-view.js';
import { clientPage } from './client-page.js';
import { makeClient, makePerson, type Person } from './firm-test-fixtures.js';
import type { CurrentUser } from './session.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

const skip = await dbSkipReason();
const asUser = (p: Person): CurrentUser => ({ ...p, demo: false, clientId: null });

describe('team addresses outside the team page (database)', { skip }, () => {
  let orgId = '';
  let admin: Person;
  let scoped: Person;
  let colleague: Person;
  let elsewhere: Person;
  let silent: Person;
  let mine = '';
  let theirs = '';

  before(async () => {
    orgId = (await makeOrg()).orgId;
    admin = await makePerson(orgId, 'admin');
    mine = await makeClient(orgId, 'Meniki');
    theirs = await makeClient(orgId, 'Boshqaniki');
    scoped = await makePerson(orgId, 'accountant', [mine]);
    colleague = await makePerson(orgId, 'accountant', [mine, theirs]);
    elsewhere = await makePerson(orgId, 'accountant', [theirs]);
    silent = await makePerson(orgId, 'viewer');
    const ev = (actorId: string, clientId: string) =>
      db.auditEvent.create({ data: { orgId, actorId, action: 'schedule.set', targetId: null, payload: { clientId } } });
    await ev(colleague.userId, mine);
    await ev(elsewhere.userId, theirs);
  });
  after(async () => {
    await dropOrgs([orgId]);
    await db.$disconnect();
  });

  it('the log’s member picker: everyone for an admin, only actors on visible events for a scoped accountant', async () => {
    const forAdmin = (await activityView(admin, {})).users.map((u) => u.id);
    for (const p of [admin, scoped, colleague, elsewhere, silent]) assert.ok(forAdmin.includes(p.userId));
    const forScoped = (await activityView(scoped, {})).users.map((u) => u.id);
    assert.deepEqual(forScoped, [colleague.userId], 'only the colleague acted on a client this accountant sees');
    // A member filter naming someone outside the picker is ignored, not trusted.
    assert.equal((await activityView(scoped, { user: elsewhere.userId })).applied.userId, null);
  });

  it('a client page lists the staff, with their other assignments for an admin only', async () => {
    const forAdmin = await clientPage(asUser(admin), mine);
    assert.deepEqual(forAdmin?.staff.find((s) => s.id === colleague.userId)?.clientIds.sort(), [mine, theirs].sort());
    const forScoped = await clientPage(asUser(scoped), mine);
    assert.ok(forScoped?.staff.some((s) => s.id === colleague.userId), 'the colleague can still be chosen');
    assert.ok(forScoped?.staff.every((s) => s.clientIds.length === 0), 'no one’s assignments reach a non-admin');
  });
});

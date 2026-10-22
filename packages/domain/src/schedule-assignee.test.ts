import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient, makePerson, type Person } from './firm-test-fixtures.js';
import { setSchedule } from './reminders.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('monthly check assignee must be able to open the client (database)', { skip }, () => {
  let org: TestActor;
  let admin: Person;
  let client = '';
  let other = '';

  before(async () => {
    org = await makeOrg();
    admin = await makePerson(org.orgId, 'admin');
    client = await makeClient(org.orgId, 'Jadval');
    other = await makeClient(org.orgId, 'Boshqa');
  });
  after(async () => {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  });

  it('refuses an accountant limited to other clients, with its own error', async () => {
    const elsewhere = await makePerson(org.orgId, 'accountant', [other]);
    const result = await setSchedule(admin, client, { dayOfMonth: 5, assigneeId: elsewhere.userId, enabled: true });
    assert.deepEqual(result, { ok: false, error: 'assignee scope' });
    assert.equal(await db.clientSchedule.count({ where: { clientId: client } }), 0);
  });

  it('accepts an assigned accountant, an unrestricted one and an admin', async () => {
    const assigned = await makePerson(org.orgId, 'accountant', [client, other]);
    const unrestricted = await makePerson(org.orgId, 'accountant');
    for (const person of [assigned, unrestricted, admin]) {
      const result = await setSchedule(admin, client, { dayOfMonth: 5, assigneeId: person.userId, enabled: true });
      assert.ok(result.ok, person.email);
      assert.equal((await db.clientSchedule.findUnique({ where: { clientId: client } }))?.assigneeId, person.userId);
    }
  });
});

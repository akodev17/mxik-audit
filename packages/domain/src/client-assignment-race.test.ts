// A scoped accountant never ends up with no assignments (= every client) when two clients are taken
// from them at once: setClientAccountants recounts under the member's row lock (F11).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { deleteClient, setClientAccountants } from './client-lifecycle.js';
import { makeClient, makePerson, type Person } from './firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('client assignments under parallel removals (database)', { skip }, () => {
  let org: TestActor;
  let admin: Person;
  before(async () => {
    org = await makeOrg();
    admin = await makePerson(org.orgId, 'admin');
    // Open the pool's connections first: a cold pool opening several at once can outlast Prisma's 2 s maxWait.
    await Promise.all(Array.from({ length: 4 }, () => db.$queryRaw`SELECT 1`));
  });
  after(async () => {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  });

  it('removing both of an accountant’s two clients at once leaves exactly one; the other removal is refused as "last"', async () => {
    for (let round = 0; round < 3; round++) {
      const a = await makeClient(org.orgId, `A${round}`);
      const b = await makeClient(org.orgId, `B${round}`);
      const accountant = await makePerson(org.orgId, 'accountant', [a, b]);
      const results = await Promise.all([setClientAccountants(admin, a, []), setClientAccountants(admin, b, [])]);
      assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
      assert.ok(results.some((r) => !r.ok && r.error === 'last'));
      assert.equal(await db.clientAssignment.count({ where: { userId: accountant.userId } }), 1);
    }
  });

  it('a client delete racing an assignment removal never strips the last assignment either', async () => {
    const a = await makeClient(org.orgId, 'Ochiriladigan');
    const b = await makeClient(org.orgId, 'Qoladigan');
    const accountant = await makePerson(org.orgId, 'accountant', [a, b]);
    await Promise.all([deleteClient(admin, a, 'Ochiriladigan'), setClientAccountants(admin, b, [])]);
    assert.ok(await db.clientAssignment.count({ where: { userId: accountant.userId } }) >= 1);
  });

  it('adding a member who has no assignments (sees every client) is still refused', async () => {
    const c = await makeClient(org.orgId, 'Yangi');
    const everyone = await makePerson(org.orgId, 'accountant');
    assert.deepEqual(await setClientAccountants(admin, c, [everyone.userId]), { ok: false, error: 'unrestricted' });
  });
});

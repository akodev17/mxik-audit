// The clients and seats caps hold under parallel requests: createClient and createInvite count
// under the org's usage lock (usage-ledger.ts lockOrgUsage) in the transaction that writes.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { createClient } from './clients.js';
import { createInvite, InviteRefused } from './invites.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('plan caps under parallel requests (database)', { skip }, () => {
  const orgs: string[] = [];
  let a: TestActor;
  before(async () => {
    a = await makeOrg();
    orgs.push(a.orgId);
    // Open the pool's connections first: a cold pool opening four at once can outlast Prisma's 2 s maxWait.
    await Promise.all(Array.from({ length: 4 }, () => db.$queryRaw`SELECT 1`));
  });
  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('six clients created at once against a cap of 3 leave exactly 3; uncapped calls are not limited', async () => {
    const admin = { ...a, role: 'admin' as const, clientIds: null };
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => createClient(admin, `Mijoz ${i}`, 3)));
    assert.equal(results.filter((r) => r.ok).length, 3);
    assert.ok(results.filter((r) => !r.ok).every((r) => !r.ok && r.error === 'full'));
    assert.equal(await db.client.count({ where: { orgId: a.orgId } }), 3);
    assert.equal((await createClient(admin, 'Yana bir mijoz')).ok, true);
  });

  it('eight invites sent at once against 3 seats (one taken by the admin) leave exactly 2 open invites', async () => {
    const b = await makeOrg();
    orgs.push(b.orgId);
    await db.user.update({ where: { id: b.userId }, data: { role: 'admin' } });
    const sent = await Promise.allSettled(Array.from({ length: 8 }, () => createInvite(b, { email: null, role: 'accountant', clientIds: [] }, 3)));
    assert.equal(sent.filter((s) => s.status === 'fulfilled').length, 2);
    for (const s of sent) if (s.status === 'rejected') assert.ok(s.reason instanceof InviteRefused && s.reason.reason === 'seats');
    assert.equal(await db.invite.count({ where: { orgId: b.orgId } }), 2);
  });
});

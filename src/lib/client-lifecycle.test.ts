import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { archiveClient, clientDependants, deleteClient } from './client-lifecycle.js';
import { db } from './db.js';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

const invite = async (orgId: string, clientIds: string[], opts: { email?: string | null; usedAt?: Date; expiresAt?: Date; role?: 'accountant' | 'admin' } = {}): Promise<string> =>
  (await db.invite.create({
    data: {
      orgId, tokenHash: randomBytes(16).toString('hex'), email: opts.email ?? null, role: opts.role ?? 'accountant', clientIds,
      usedAt: opts.usedAt ?? null, expiresAt: opts.expiresAt ?? new Date(Date.now() + 86_400_000),
    },
    select: { id: true },
  })).id;

describe('deleting or archiving a client never widens anyone’s access (database)', { skip }, () => {
  let org: TestActor;
  let admin: Person;

  before(async () => {
    org = await makeOrg();
    admin = await makePerson(org.orgId, 'admin');
  });
  after(async () => {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  });

  it('refuses to delete the only client of a scoped accountant or viewer and names them', async () => {
    const only = await makeClient(org.orgId, 'Yagona');
    const other = await makeClient(org.orgId, 'Boshqa');
    const { catalogId } = await makeClientCatalog(org.orgId, only, [{ name: 'Guruch', findings: [{ severity: 'high' }] }]);
    const accountant = await makePerson(org.orgId, 'accountant', [only]);
    const viewer = await makePerson(org.orgId, 'viewer', [only]);
    await makePerson(org.orgId, 'accountant', [only, other]);
    await makePerson(org.orgId, 'admin', [only]);

    const refused = await deleteClient(admin, only, 'Yagona');
    assert.equal(refused.ok, false);
    assert.ok(!refused.ok && 'blockers' in refused);
    assert.deepEqual(refused.blockers.map((b) => b.email).sort(), [accountant.email, viewer.email].sort());
    assert.ok(refused.blockers.every((b) => b.kind === 'member'));
    // Nothing was removed, not even the catalogue.
    assert.equal(await db.client.count({ where: { id: only } }), 1);
    assert.equal(await db.catalog.count({ where: { id: catalogId } }), 1);
    assert.equal(await db.clientAssignment.count({ where: { userId: accountant.userId } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: org.orgId, action: 'client.deleted', targetId: only } }), 0);

    // Once the accountant and the viewer have another client, the delete goes through.
    await db.clientAssignment.createMany({ data: [accountant, viewer].map((p) => ({ userId: p.userId, clientId: other })) });
    assert.deepEqual(await deleteClient(admin, only, 'Yagona'), { ok: true, catalogs: 1 });
    assert.deepEqual((await db.clientAssignment.findMany({ where: { userId: accountant.userId }, select: { clientId: true } })).map((a) => a.clientId), [other]);
  });

  it('an open invite whose only client this is blocks; other open invites lose the client id', async () => {
    const target = await makeClient(org.orgId, 'Taklifli');
    const kept = await makeClient(org.orgId, 'Qoladigan');
    const lone = await invite(org.orgId, [target], { email: 'yangi@test.local' });
    const shared = await invite(org.orgId, [target, kept]);
    const used = await invite(org.orgId, [target], { usedAt: new Date() });
    const expired = await invite(org.orgId, [target], { expiresAt: new Date(Date.now() - 1000) });
    const forAdmin = await invite(org.orgId, [target], { role: 'admin' });

    const refused = await deleteClient(admin, target, 'Taklifli');
    assert.ok(!refused.ok && 'blockers' in refused);
    assert.deepEqual(refused.blockers, [{ kind: 'invite', email: 'yangi@test.local' }]);

    await db.invite.delete({ where: { id: lone } });
    assert.ok((await deleteClient(admin, target, 'Taklifli')).ok);
    const lists = new Map((await db.invite.findMany({ where: { id: { in: [shared, used, expired, forAdmin] } }, select: { id: true, clientIds: true } })).map((i) => [i.id, i.clientIds]));
    assert.deepEqual(lists.get(shared), [kept]);
    assert.deepEqual(lists.get(expired), []);
    assert.deepEqual(lists.get(forAdmin), []);
    assert.deepEqual(lists.get(used), [target], 'a used invite is history and stays as it was');
    const event = await db.auditEvent.findFirst({ where: { orgId: org.orgId, action: 'client.deleted', targetId: target }, select: { payload: true } });
    assert.equal((event?.payload as { invitesUpdated?: number } | undefined)?.invitesUpdated, 3);
  });

  it('archiving still works but names members left with no active client', async () => {
    const active = await makeClient(org.orgId, 'Faol');
    const spare = await makeClient(org.orgId, 'Zaxira');
    const shelved = await makeClient(org.orgId, 'Eski', { archived: true });
    const stranded = await makePerson(org.orgId, 'accountant', [active]);
    const onlyArchivedLeft = await makePerson(org.orgId, 'viewer', [active, shelved]);
    await makePerson(org.orgId, 'accountant', [active, spare]);
    await makePerson(org.orgId, 'accountant');

    const before = await clientDependants(org.orgId, active);
    assert.deepEqual(before.archiveStranded.sort(), [stranded.email, onlyArchivedLeft.email].sort());

    const done = await archiveClient(admin, active);
    assert.ok(done.ok);
    assert.deepEqual(done.stranded.sort(), [stranded.email, onlyArchivedLeft.email].sort());
    assert.ok((await db.client.findUnique({ where: { id: active } }))?.archivedAt);
    // Assignments are untouched: archiving narrows nobody and widens nobody.
    assert.equal(await db.clientAssignment.count({ where: { userId: stranded.userId } }), 1);
  });
});

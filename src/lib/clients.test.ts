import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { archiveClient, deleteClient, renameClient, restoreClient, setClientAccountants } from './client-lifecycle.js';
import { clientStats } from './client-stats.js';
import { createClient, defaultClient } from './clients.js';
import { db } from './db.js';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { queuePage } from './queue.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('client creation and lifecycle (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let admin: Person;

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    admin = await makePerson(a.orgId, 'admin');
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('a scoped accountant who creates a client is assigned to it in the same step', async () => {
    const first = await makeClient(a.orgId, 'Birinchi');
    const accountant = await makePerson(a.orgId, 'accountant', [first]);
    const made = await createClient(accountant, '  Yangi   mijoz ');
    assert.ok(made.ok);
    const row = await db.client.findUnique({ where: { id: made.clientId } });
    assert.equal(row?.name, 'Yangi mijoz');
    const assignment = await db.clientAssignment.findUnique({ where: { userId_clientId: { userId: accountant.userId, clientId: made.clientId } } });
    assert.ok(assignment, 'creator must be able to open the client');
    const event = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'client.created', targetId: made.clientId } });
    assert.ok(event);
  });

  it('an unrestricted accountant is not narrowed by creating a client; a viewer cannot create one', async () => {
    const open = await makePerson(a.orgId, 'accountant');
    const made = await createClient(open, 'Ochiq');
    assert.ok(made.ok);
    assert.equal(await db.clientAssignment.count({ where: { userId: open.userId } }), 0);

    const viewer = await makePerson(a.orgId, 'viewer');
    const refused = await createClient(viewer, 'Koʻruvchi');
    assert.deepEqual(refused, { ok: false, error: 'forbidden' });
    assert.equal((await createClient(admin, 'x')).ok, false);
  });

  it('archiving hides the client from lists and the queue until it is restored', async () => {
    const id = await makeClient(a.orgId, 'Arxivlanadigan');
    await makeClientCatalog(a.orgId, id, [{ name: 'Guruch', findings: [{ severity: 'high' }] }]);
    const listed = async () => (await clientStats({ orgId: a.orgId, clientIds: null, limit: 100 })).rows.some((c) => c.id === id);
    const queued = async () => (await queuePage({ orgId: a.orgId, clientIds: null }, { clientId: null, type: null, severity: null, askClient: false, accountantId: null, due: null }, null)).byClient.some((c) => c.clientId === id);
    assert.ok(await listed());
    assert.ok(await queued());

    const accountant = await makePerson(a.orgId, 'accountant');
    assert.deepEqual(await archiveClient(accountant, id), { ok: false, error: 'forbidden' });
    assert.ok((await archiveClient(admin, id)).ok);
    assert.ok(!(await listed()));
    assert.ok(!(await queued()));
    assert.ok((await clientStats({ orgId: a.orgId, clientIds: null, filter: 'archived', limit: 100 })).rows.some((c) => c.id === id));

    assert.ok((await restoreClient(admin, id)).ok);
    assert.ok(await listed());
    const actions = (await db.auditEvent.findMany({ where: { orgId: a.orgId, targetId: id }, select: { action: true } })).map((e) => e.action);
    assert.ok(actions.includes('client.archived') && actions.includes('client.restored'));
  });

  it('the default client cannot be archived or deleted; another org’s client cannot be touched', async () => {
    const fallback = await defaultClient(a.orgId);
    assert.deepEqual(await archiveClient(admin, fallback.id), { ok: false, error: 'default' });
    assert.deepEqual(await deleteClient(admin, fallback.id, fallback.name), { ok: false, error: 'default' });
    const foreign = await makeClient(b.orgId, 'Begona');
    assert.deepEqual(await renameClient(admin, foreign, 'Meniki'), { ok: false, error: 'not found' });
    assert.equal((await db.client.findUnique({ where: { id: foreign } }))?.name, 'Begona');
  });

  it('delete needs the exact name, removes the data and keeps the audit trail', async () => {
    const id = await makeClient(a.orgId, 'Oʻchiriladigan');
    const { catalogId } = await makeClientCatalog(a.orgId, id, [{ name: 'Guruch', findings: [{ severity: 'high' }] }]);
    await db.auditEvent.create({ data: { orgId: a.orgId, actorId: admin.userId, action: 'finding.accepted', targetId: 'x', payload: { catalogId } } });

    assert.deepEqual(await deleteClient(admin, id, 'Ochiriladigan'), { ok: false, error: 'name mismatch' });
    const done = await deleteClient(admin, id, ' Oʻchiriladigan ');
    assert.deepEqual(done, { ok: true, catalogs: 1 });
    assert.equal(await db.client.count({ where: { id } }), 0);
    assert.equal(await db.catalog.count({ where: { id: catalogId } }), 0);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'finding.accepted', payload: { path: ['catalogId'], equals: catalogId } } }), 1);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'catalog.deleted', targetId: catalogId } }));
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'client.deleted', targetId: id } }));
  });

  it('assigning accountants never silently widens or narrows anyone’s access', async () => {
    const client = await makeClient(a.orgId, 'Biriktirish');
    const other = await makeClient(a.orgId, 'Boshqa');
    const onlyHere = await makePerson(a.orgId, 'accountant', [client]);
    const twoClients = await makePerson(a.orgId, 'accountant', [client, other]);
    const unrestricted = await makePerson(a.orgId, 'accountant');
    const scopedElsewhere = await makePerson(a.orgId, 'accountant', [other]);

    assert.deepEqual(await setClientAccountants(admin, client, [onlyHere.userId, twoClients.userId, unrestricted.userId]), { ok: false, error: 'unrestricted' });
    assert.deepEqual(await setClientAccountants(admin, client, [twoClients.userId]), { ok: false, error: 'last' });
    const ok = await setClientAccountants(admin, client, [onlyHere.userId, scopedElsewhere.userId]);
    assert.deepEqual(ok, { ok: true, added: 1, removed: 1 });
    const now = (await db.clientAssignment.findMany({ where: { clientId: client }, select: { userId: true } })).map((r) => r.userId).sort();
    assert.deepEqual(now, [onlyHere.userId, scopedElsewhere.userId].sort());
    assert.equal(await db.clientAssignment.count({ where: { userId: unrestricted.userId } }), 0);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'client.accountants_set', targetId: client } }));
    assert.deepEqual(await setClientAccountants(onlyHere, client, []), { ok: false, error: 'forbidden' });
  });
});

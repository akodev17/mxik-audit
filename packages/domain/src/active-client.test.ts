import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resolveVisibleClient, switchableClient, visibleClients } from './active-client.js';
import { db } from './db.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('active client (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  const c = { def: '', alfa: '', beta: '', archived: '', other: '' };

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    c.def = (await db.client.create({ data: { orgId: a.orgId, name: 'Asosiy', isDefault: true } })).id;
    c.alfa = (await db.client.create({ data: { orgId: a.orgId, name: 'Alfa' } })).id;
    c.beta = (await db.client.create({ data: { orgId: a.orgId, name: 'Beta' } })).id;
    c.archived = (await db.client.create({ data: { orgId: a.orgId, name: 'Arxiv', archivedAt: new Date() } })).id;
    c.other = (await db.client.create({ data: { orgId: b.orgId, name: 'Begona' } })).id;
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('keeps the remembered client when the user may still see it', async () => {
    const got = await resolveVisibleClient({ orgId: a.orgId, clientId: c.beta, clientIds: null });
    assert.equal(got?.id, c.beta);
  });

  it('falls back to the first client in scope when the remembered one is out of scope', async () => {
    const got = await resolveVisibleClient({ orgId: a.orgId, clientId: c.alfa, clientIds: [c.beta] });
    assert.equal(got?.id, c.beta);
  });

  it('never makes an archived or foreign client active', async () => {
    assert.equal((await resolveVisibleClient({ orgId: a.orgId, clientId: c.archived, clientIds: null }))?.id, c.def);
    assert.equal((await resolveVisibleClient({ orgId: a.orgId, clientId: c.other, clientIds: null }))?.id, c.def);
    assert.equal(await resolveVisibleClient({ orgId: a.orgId, clientId: null, clientIds: [c.archived] }), null);
  });

  it('lists only switchable clients, default first', async () => {
    assert.deepEqual((await visibleClients({ orgId: a.orgId, clientIds: null })).map((x) => x.id), [c.def, c.alfa, c.beta]);
    assert.deepEqual((await visibleClients({ orgId: a.orgId, clientIds: [c.beta, c.archived] })).map((x) => x.id), [c.beta]);
  });

  it('refuses to switch to a client outside the scope, archived, or of another org', async () => {
    assert.equal(await switchableClient({ orgId: a.orgId, clientIds: [c.beta] }, c.alfa), null);
    assert.equal(await switchableClient({ orgId: a.orgId, clientIds: null }, c.archived), null);
    assert.equal(await switchableClient({ orgId: a.orgId, clientIds: null }, c.other), null);
    assert.equal((await switchableClient({ orgId: a.orgId, clientIds: [c.beta] }, c.beta))?.id, c.beta);
  });
});

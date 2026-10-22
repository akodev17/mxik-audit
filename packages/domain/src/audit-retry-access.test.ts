import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { retryAudit } from './audit-jobs.js';
import { db } from './db.js';
import { makeClient, makeClientCatalog, makePerson } from './firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

async function settled(catalogId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await db.catalog.findUniqueOrThrow({ where: { id: catalogId }, select: { status: true } });
    if (c.status === 'ready' || c.status === 'failed') return c.status;
    if (Date.now() > deadline) throw new Error(`catalogue still ${c.status}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

describe('retryAudit refuses viewers on its own (database)', { skip }, () => {
  let a: TestActor;

  before(async () => { a = await makeOrg(); });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('a viewer, even of every client, cannot restart a failed audit; an accountant can', async () => {
    const client = await makeClient(a.orgId, 'retry-client');
    const { catalogId, findingIds } = await makeClientCatalog(a.orgId, client, [{ name: 'Tuz', findings: [{}] }]);
    await db.catalog.update({ where: { id: catalogId }, data: { status: 'failed', auditError: 'boom' } });

    const viewer = await makePerson(a.orgId, 'viewer');
    assert.equal(await retryAudit(viewer, catalogId), false);
    assert.equal((await db.catalog.findUniqueOrThrow({ where: { id: catalogId } })).status, 'failed');
    assert.equal(await db.finding.count({ where: { id: { in: findingIds.flat() } } }), 1, 'a refused retry deletes nothing');

    const accountant = await makePerson(a.orgId, 'accountant', [client]);
    assert.equal(await retryAudit(accountant, catalogId), true);
    await settled(catalogId);
  });
});

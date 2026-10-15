import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { listCatalogs, resolveCatalog } from './catalogs.js';
import { db } from './db.js';
import { recordDecision } from './decisions.js';
import { isDemoOrg, purgeExpiredDemos, startDemoSession, type DemoSession } from './demo.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('demo mode (database)', { skip }, () => {
  let template: TestActor;
  let customer: TestActor;
  let customerCatalog = '';
  const sessions: DemoSession[] = [];

  before(async () => {
    const code = (await liveCodes(1))[0] ?? null;
    template = await makeOrg('demo_template');
    await makeCatalog(template.orgId, [
      { rawName: 'Demo guruch', suggestedMxik: code, confidence: 0.95 },
      { rawName: 'Demo shakar', suggestedMxik: code, confidence: 0.7 },
    ]);
    customer = await makeOrg('customer');
    customerCatalog = (await makeCatalog(customer.orgId, [{ rawName: 'Real customer row', suggestedMxik: code, confidence: 0.8 }])).catalogId;
  });
  after(async () => {
    await dropOrgs([template.orgId, customer.orgId, ...sessions.map((s) => s.orgId)]);
    await db.$disconnect();
  });

  it('gives each visitor a separate, undecided copy of the template', async () => {
    const visitsBefore = await db.demoVisit.count();
    const one = await startDemoSession();
    const two = await startDemoSession();
    // The durable traction count survives the copies' daily purge.
    assert.equal(await db.demoVisit.count(), visitsBefore + 2);
    assert.ok(one && two);
    sessions.push(one, two);
    assert.notEqual(one.orgId, two.orgId);
    assert.ok(await isDemoOrg(one.orgId));

    const [catalog] = await listCatalogs(one.orgId);
    assert.equal(catalog?.rowCount, 2);
    assert.equal(await db.finding.count({ where: { item: { catalog: { orgId: one.orgId } }, decision: 'pending' } }), 2);
  });

  it('keeps one visitor’s decisions out of another’s copy', async () => {
    const [one, two] = sessions;
    assert.ok(one && two);
    const finding = await db.finding.findFirst({ where: { item: { catalog: { orgId: one.orgId } } } });
    assert.ok(finding);
    assert.ok((await recordDecision({ orgId: one.orgId, userId: one.userId }, { findingId: finding.id, decision: 'rejected' })).ok);
    assert.equal(await db.finding.count({ where: { item: { catalog: { orgId: two.orgId } }, decision: { not: 'pending' } } }), 0);
  });

  it('never lets a demo session reach a real org’s data', async () => {
    const [one] = sessions;
    assert.ok(one);
    assert.equal(await resolveCatalog(one.orgId, customerCatalog), null);
    assert.ok(!(await listCatalogs(one.orgId)).some((c) => c.id === customerCatalog));
    const foreignFinding = await db.finding.findFirst({ where: { item: { catalogId: customerCatalog } } });
    assert.ok(foreignFinding);
    const r = await recordDecision({ orgId: one.orgId, userId: one.userId }, { findingId: foreignFinding.id, decision: 'rejected' });
    assert.equal(r.ok, false);
  });

  it('purges expired demo copies and nothing else', async () => {
    // Expire only this test's copies, then purge at the real current time. A
    // future "now" would also delete live demos of anyone using this database.
    const ids = sessions.map((s) => s.orgId);
    await db.organization.updateMany({ where: { id: { in: ids } }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const live = await startDemoSession();
    assert.ok(live);
    sessions.push(live);

    await purgeExpiredDemos(new Date());
    assert.equal(await db.organization.count({ where: { id: { in: ids } } }), 0);
    assert.equal(await db.organization.count({ where: { id: live.orgId } }), 1, 'an unexpired demo must survive');
    assert.equal(await db.organization.count({ where: { id: { in: [template.orgId, customer.orgId] } } }), 2);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { isAdmin } from './admin.js';
import { db } from './db.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg, type TestActor } from './test-fixtures.js';
import { medianReviewSeconds, tractionMetrics } from './traction.js';

const at = (s: number): Date => new Date(Date.UTC(2026, 9, 15, 10, 0, s));

describe('isAdmin', () => {
  it('matches ADMIN_EMAILS case-insensitively and trims spaces', () => {
    const env = { ADMIN_EMAILS: ' Owner@Example.uz , second@example.uz' };
    assert.equal(isAdmin('owner@example.uz', env), true);
    assert.equal(isAdmin('SECOND@example.uz', env), true);
    assert.equal(isAdmin('someone@example.uz', env), false);
  });

  it('admits nobody when the list is empty or the email missing', () => {
    assert.equal(isAdmin('owner@example.uz', {}), false);
    assert.equal(isAdmin(null, { ADMIN_EMAILS: 'owner@example.uz' }), false);
  });
});

describe('medianReviewSeconds', () => {
  it('measures gaps between one reviewer\'s decisions in one catalogue', () => {
    const r = medianReviewSeconds([
      { actorId: 'u1', catalogId: 'c1', at: at(0) },
      { actorId: 'u1', catalogId: 'c1', at: at(10) },
      { actorId: 'u1', catalogId: 'c1', at: at(40) },
      // Another reviewer and another catalogue never pair with the first.
      { actorId: 'u2', catalogId: 'c1', at: at(5) },
      { actorId: 'u1', catalogId: 'c2', at: at(6) },
    ]);
    assert.deepEqual(r, { median: 20, samples: 2 });
  });

  it('ignores breaks longer than ten minutes', () => {
    const r = medianReviewSeconds([
      { actorId: 'u1', catalogId: 'c1', at: at(0) },
      { actorId: 'u1', catalogId: 'c1', at: at(8) },
      { actorId: 'u1', catalogId: 'c1', at: new Date(at(8).getTime() + 30 * 60_000) },
    ]);
    assert.deepEqual(r, { median: 8, samples: 1 });
  });

  it('is null without at least two decisions in a row', () => {
    assert.deepEqual(medianReviewSeconds([{ actorId: 'u1', catalogId: 'c1', at: at(0) }]), { median: null, samples: 0 });
  });
});

const skip = await dbSkipReason();

describe('tractionMetrics (database)', { skip }, () => {
  let customer: TestActor;
  let demo: TestActor;
  let internal: TestActor;
  let codes: string[] = [];

  before(async () => {
    codes = await liveCodes(2);
    customer = await makeOrg('customer');
    demo = await makeOrg('demo', new Date(Date.now() + 3_600_000));
    internal = await makeOrg('internal');
    // The same activity in all three orgs; only the customer's may count.
    for (const org of [customer, demo, internal]) {
      const { catalogId, findingIds } = await makeCatalog(org.orgId, [
        { rawName: 'Guruch', suggestedMxik: codes[0] ?? null, confidence: 0.9 },
        { rawName: 'Shakar', suggestedMxik: codes[0] ?? null, confidence: 0.7 },
        { rawName: 'Tuz', suggestedMxik: codes[0] ?? null, confidence: 0.7 },
        { rawName: 'Un', suggestedMxik: codes[0] ?? null, confidence: 0.7 },
      ]);
      await db.finding.update({ where: { id: findingIds[0] }, data: { decision: 'accepted', chosenMxik: codes[0] ?? null } });
      await db.finding.update({ where: { id: findingIds[1] }, data: { decision: 'accepted', chosenMxik: codes[1] ?? null } });
      await db.finding.update({ where: { id: findingIds[2] }, data: { decision: 'rejected' } });
      await db.auditEvent.createMany({
        data: [
          { orgId: org.orgId, actorId: org.userId, action: 'finding.accepted', payload: { catalogId }, createdAt: at(0) },
          { orgId: org.orgId, actorId: org.userId, action: 'finding.accepted', payload: { catalogId }, createdAt: at(30) },
          { orgId: org.orgId, actorId: org.userId, action: 'finding.rejected', payload: { catalogId }, createdAt: at(60) },
          { orgId: org.orgId, actorId: org.userId, action: 'finding.bulk_accepted', payload: { catalogId, count: 7 }, createdAt: at(90) },
          { orgId: org.orgId, actorId: org.userId, action: 'finding.undone', payload: { catalogId }, createdAt: at(95) },
        ],
      });
    }
  });
  after(async () => {
    await dropOrgs([customer.orgId, demo.orgId, internal.orgId]);
    await db.$disconnect();
  });

  it('counts the customer org only, never demo or internal orgs', async () => {
    const m = await tractionMetrics([customer.orgId, demo.orgId, internal.orgId]);
    assert.equal(m.orgs.customers, 1);
    assert.equal(m.catalogs.total, 1);
    assert.equal(m.rows.audited, 4);
    assert.equal(m.rows.risky, 4);
    assert.deepEqual(m.findingsByType, { MISSING: 4 });
    assert.deepEqual(m.decisions, { accepted: 1, edited: 1, rejected: 1, pending: 1, bulkAcceptedRows: 7, undone: 1 });
    assert.deepEqual(m.review, { medianSecondsPerRow: 30, sampleIntervals: 2 });
  });

  it('reports zeros for a scope with no customers', async () => {
    const m = await tractionMetrics([demo.orgId, internal.orgId]);
    assert.equal(m.orgs.customers, 0);
    assert.equal(m.rows.risky, 0);
    assert.equal(m.review.medianSecondsPerRow, null);
  });
});

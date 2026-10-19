import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { bulkAccept, decisionHistory, recordDecision, reopenDecision, undoDecision, undoLast } from './decisions.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('review decisions (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let codes: string[] = [];

  before(async () => {
    codes = await liveCodes(2);
    a = await makeOrg();
    b = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  const twoRows = () => makeCatalog(a.orgId, [
    { rawName: 'Guruch', suggestedMxik: codes[0] ?? null, confidence: 0.95 },
    { rawName: 'Shakar', suggestedMxik: codes[1] ?? null, confidence: 0.7 },
  ]);

  it('undo appends a new event and leaves the original event untouched', async () => {
    const { findingIds } = await twoRows();
    const decided = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' });
    assert.ok(decided.ok);
    const original = await db.auditEvent.findUnique({ where: { id: decided.eventId } });

    const undone = await undoDecision(a, decided.eventId);
    assert.ok(undone.ok);
    const finding = await db.finding.findUnique({ where: { id: findingIds[0] } });
    assert.equal(finding?.decision, 'pending');
    assert.equal(finding?.chosenMxik, null);
    assert.equal(finding?.decisionEventId, null);

    assert.deepEqual(await db.auditEvent.findUnique({ where: { id: decided.eventId } }), original);
    const undoEvent = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'finding.undone', targetId: decided.eventId } });
    assert.ok(undoEvent, 'undo must be recorded as a new event');

    const again = await undoDecision(a, decided.eventId);
    assert.equal(again.ok, false);
  });

  it('undo-last reverts the most recent decision still in effect', async () => {
    const { catalogId, findingIds } = await twoRows();
    await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' });
    await recordDecision(a, { findingId: findingIds[1] ?? '', decision: 'rejected' });
    const undone = await undoLast(a, catalogId);
    assert.ok(undone.ok);
    assert.deepEqual(undone.findingIds, [findingIds[1]]);
    const first = await db.finding.findUnique({ where: { id: findingIds[0] } });
    assert.equal(first?.decision, 'accepted');
  });

  it('refuses to overwrite a decision that was not undone', async () => {
    const { findingIds } = await twoRows();
    assert.ok((await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' })).ok);
    const second = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'rejected' });
    assert.equal(second.ok, false);
  });

  it('refuses to accept a code that is not in the classifier', async () => {
    const { findingIds } = await twoRows();
    const r = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted', chosenMxik: '99999999999999999' });
    assert.equal(r.ok, false);
    assert.equal((await db.finding.findUnique({ where: { id: findingIds[0] } }))?.decision, 'pending');
  });

  it('bulk accept takes only the high band, and undoing it reverts every row it touched', async () => {
    const { catalogId, findingIds } = await twoRows();
    assert.equal((await bulkAccept(a, { catalogId, minConfidence: 0.5 })).ok, false);
    const bulk = await bulkAccept(a, { catalogId, minConfidence: 0.9 });
    assert.ok(bulk.ok);
    assert.equal(bulk.count, 1);
    assert.equal((await db.finding.findUnique({ where: { id: findingIds[1] } }))?.decision, 'pending');

    assert.ok(bulk.eventId);
    const undone = await undoDecision(a, bulk.eventId);
    assert.ok(undone.ok);
    assert.equal((await db.finding.findUnique({ where: { id: findingIds[0] } }))?.decision, 'pending');
  });

  it('history lists decisions newest first and marks which can still be undone', async () => {
    const { catalogId, findingIds } = await twoRows();
    const first = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' });
    assert.ok(first.ok);
    await undoDecision(a, first.eventId);
    await recordDecision(a, { findingId: findingIds[1] ?? '', decision: 'rejected' });
    const history = await decisionHistory(a, catalogId);
    assert.deepEqual(history.map((h) => h.action), ['finding.rejected', 'finding.undone', 'finding.accepted']);
    assert.deepEqual(history.map((h) => h.undoable), [true, false, false]);
    assert.equal(history[2]?.productName, 'Guruch');
  });

  it('change decision reopens a row: through its event, or with an event of its own when it has none', async () => {
    const { findingIds } = await twoRows();
    const decided = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' });
    assert.ok(decided.ok);
    const viaEvent = await reopenDecision(a, findingIds[0] ?? '');
    assert.ok(viaEvent.ok);
    assert.equal((await db.finding.findUnique({ where: { id: findingIds[0] } }))?.decision, 'pending');
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'finding.undone', targetId: decided.eventId } }));

    // An older decision recorded without an event (seeded or imported data).
    await db.finding.update({ where: { id: findingIds[1] }, data: { decision: 'rejected', decidedBy: a.userId, decidedAt: new Date() } });
    assert.equal((await reopenDecision(b, findingIds[1] ?? '')).ok, false, 'another org cannot reopen it');
    const legacy = await reopenDecision(a, findingIds[1] ?? '');
    assert.ok(legacy.ok);
    assert.deepEqual(legacy.findingIds, [findingIds[1]]);
    const row = await db.finding.findUnique({ where: { id: findingIds[1] } });
    assert.equal(row?.decision, 'pending');
    assert.equal(row?.decidedBy, null);
    const event = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'finding.undone', targetId: findingIds[1] } });
    const payload = event?.payload as { reopened?: boolean; findings?: { previousDecision?: string }[] } | undefined;
    assert.equal(payload?.reopened, true);
    assert.equal(payload?.findings?.[0]?.previousDecision, 'rejected');
    assert.equal((await reopenDecision(a, findingIds[1] ?? '')).ok, false, 'a pending row has nothing to reopen');
  });

  it('another org can neither decide, bulk-accept, undo nor read the history', async () => {
    const { catalogId, findingIds } = await twoRows();
    assert.equal((await recordDecision(b, { findingId: findingIds[0] ?? '', decision: 'accepted' })).ok, false);
    assert.equal((await bulkAccept(b, { catalogId, minConfidence: 0.9 })).ok, false);

    const mine = await recordDecision(a, { findingId: findingIds[0] ?? '', decision: 'accepted' });
    assert.ok(mine.ok);
    assert.equal((await undoDecision(b, mine.eventId)).ok, false);
    assert.equal((await undoLast(b, catalogId)).ok, false);
    assert.deepEqual(await decisionHistory(b, catalogId), []);
    assert.equal((await db.finding.findUnique({ where: { id: findingIds[0] } }))?.decision, 'accepted');
  });
});

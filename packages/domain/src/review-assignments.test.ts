import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { makeClient, makeClientCatalog, makePerson, type Person } from './firm-test-fixtures.js';
import { auditReadyText, reviewAssignedText, reviewCompletedText } from './notification-text.js';
import { latestPerClient, listNotifications, markAllRead, notify, unreadCount } from './notifications.js';
import { assignableMembers, assignReview, completeReview, parseDueDate, reviewCounts, reviewsFor } from './review-assignments.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

// 20 October 2026, 10:00 in Tashkent.
const NOW = new Date('2026-10-20T05:00:00Z');

describe('review assignment inputs (pure)', () => {
  it('accepts only real calendar days', () => {
    assert.equal(parseDueDate('2026-10-21')?.toISOString().slice(0, 10), '2026-10-21');
    assert.equal(parseDueDate('2026-02-30'), null);
    assert.equal(parseDueDate('21.10.2026'), null);
    assert.equal(parseDueDate(''), null);
  });

  it('words each notice in the org language and names the facts it was given', () => {
    const assigned = reviewAssignedText({ clientName: 'Acme', filename: 'a.xlsx', dueOn: new Date('2026-10-25T00:00:00Z'), note: 'tez', by: 'x@y.z' }, 'ru');
    assert.match(assigned.title, /Acme/);
    assert.match(assigned.body, /a\.xlsx/);
    assert.match(assigned.body, /tez/);
    assert.match(reviewCompletedText({ clientName: 'Acme', filename: 'a.xlsx' }, 'uz').title, /Acme/);
    assert.match(auditReadyText({ clientName: 'Acme', filename: 'a.xlsx', open: 7 }, 'uz').body, /7/);
    assert.notEqual(auditReadyText({ clientName: 'Acme', filename: 'a.xlsx', open: 7 }, 'uz').title, auditReadyText({ clientName: 'Acme', filename: 'a.xlsx', open: 7 }, 'ru').title);
  });
});

const skip = await dbSkipReason();

describe('review assignments (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let admin: Person;
  let boss: Person;
  let worker: Person;
  let otherScope: Person;
  let viewer: Person;
  let c1 = '';
  let c2 = '';
  let ready = '';
  let uploaded = '';
  let foreign = '';

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    admin = await makePerson(a.orgId, 'admin');
    boss = await makePerson(a.orgId, 'accountant');
    c1 = await makeClient(a.orgId, 'Birinchi');
    c2 = await makeClient(a.orgId, 'Ikkinchi');
    worker = await makePerson(a.orgId, 'accountant', [c1]);
    otherScope = await makePerson(a.orgId, 'accountant', [c2]);
    viewer = await makePerson(a.orgId, 'viewer');
    ready = (await makeClientCatalog(a.orgId, c1, [{ name: 'x', findings: [{}] }], { status: 'ready' })).catalogId;
    uploaded = (await makeClientCatalog(a.orgId, c1, [{ name: 'y', findings: [] }], { status: 'uploaded' })).catalogId;
    const theirs = await makeClient(b.orgId, 'Boshqa tashkilot');
    foreign = (await makeClientCatalog(b.orgId, theirs, [{ name: 'z', findings: [] }])).catalogId;
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  const input = (assigneeId: string, over: Partial<{ catalogId: string; dueOn: string | null; note: string | null }> = {}) =>
    ({ catalogId: ready, assigneeId, dueOn: '2026-10-25', note: 'tekshiring', ...over });

  it('refuses people who may not hand out or receive a review', async () => {
    assert.deepEqual(await assignReview(viewer, input(worker.userId), NOW), { ok: false, error: 'not found' });
    assert.deepEqual(await assignReview(worker, input(worker.userId, { catalogId: foreign }), NOW), { ok: false, error: 'not found' });
    assert.deepEqual(await assignReview({ ...admin, orgId: b.orgId }, input(worker.userId), NOW), { ok: false, error: 'not found' });
    // A catalogue of a client outside the giver's scope looks missing.
    assert.deepEqual(await assignReview(otherScope, input(worker.userId), NOW), { ok: false, error: 'not found' });
    assert.deepEqual(await assignReview(admin, input(viewer.userId), NOW), { ok: false, error: 'bad assignee' });
    assert.deepEqual(await assignReview(admin, input('nobody'), NOW), { ok: false, error: 'bad assignee' });
    assert.deepEqual(await assignReview(admin, input(otherScope.userId), NOW), { ok: false, error: 'assignee scope' });
    assert.equal(await db.reviewAssignment.count({ where: { orgId: a.orgId } }), 0);
  });

  it('checks the catalogue state, the due date and the note', async () => {
    assert.deepEqual(await assignReview(admin, input(worker.userId, { catalogId: uploaded }), NOW), { ok: false, error: 'not ready' });
    assert.deepEqual(await assignReview(admin, input(worker.userId, { dueOn: '2026-10-19' }), NOW), { ok: false, error: 'due past' });
    assert.deepEqual(await assignReview(admin, input(worker.userId, { dueOn: '2026-13-40' }), NOW), { ok: false, error: 'bad due' });
    assert.deepEqual(await assignReview(admin, input(worker.userId, { note: 'x'.repeat(501) }), NOW), { ok: false, error: 'bad note' });
    assert.equal((await assignReview(admin, input(worker.userId, { dueOn: '2026-10-20', note: '  ' }), NOW)).ok, true, 'today is allowed, a blank note is none');
    assert.equal((await db.reviewAssignment.findUnique({ where: { catalogId: ready } }))?.note, null);
  });

  it('lists only members who may open the client', async () => {
    const ids = (await assignableMembers(admin, c1)).map((m) => m.id);
    assert.ok(ids.includes(worker.userId) && ids.includes(boss.userId) && ids.includes(admin.userId));
    assert.ok(!ids.includes(viewer.userId) && !ids.includes(otherScope.userId));
    assert.deepEqual(await assignableMembers(otherScope, c1), []);
  });

  it('assigning notifies the assignee alone, once, and again only after a real change', async () => {
    await db.reviewAssignment.deleteMany({ where: { orgId: a.orgId } });
    await db.notification.deleteMany({ where: { orgId: a.orgId } });
    await db.auditEvent.deleteMany({ where: { orgId: a.orgId, action: 'review.assigned' } });
    const first = await assignReview(admin, input(worker.userId), NOW);
    assert.equal(first.ok && first.changed, true);
    const again = await assignReview(admin, input(worker.userId), NOW);
    assert.equal(again.ok && again.changed, false, 'the same request changes nothing');
    assert.equal(await db.notification.count({ where: { orgId: a.orgId, kind: 'review.assigned' } }), 1);
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'review.assigned' } }), 1);

    assert.equal(await unreadCount(worker), 1);
    assert.equal(await unreadCount(boss), 0, 'a personal notice is not shown to colleagues');
    assert.equal(await unreadCount(admin), 0, 'not even to an admin');
    const mine = await listNotifications(worker);
    assert.equal(mine.items[0]?.href, `/catalogs/${ready}`);
    assert.equal(await unreadCount({ ...worker, orgId: b.orgId }), 0);

    // New due date: revision 2, a second notice.
    const moved = await assignReview(admin, input(worker.userId, { dueOn: '2026-10-30' }), NOW);
    assert.equal(moved.ok && moved.changed, true);
    assert.equal(await db.notification.count({ where: { orgId: a.orgId, kind: 'review.assigned' } }), 2);
    assert.equal((await db.reviewAssignment.findUnique({ where: { catalogId: ready } }))?.revision, 2);
  });

  it('handing a review to oneself raises no notice', async () => {
    await db.reviewAssignment.deleteMany({ where: { orgId: a.orgId } });
    await db.notification.deleteMany({ where: { orgId: a.orgId } });
    assert.equal((await assignReview(boss, input(boss.userId), NOW)).ok, true);
    assert.equal(await db.notification.count({ where: { orgId: a.orgId } }), 0);
  });

  it('only the assignee or an admin completes it; completing twice is refused; the assigner is told once', async () => {
    await db.reviewAssignment.deleteMany({ where: { orgId: a.orgId } });
    await db.notification.deleteMany({ where: { orgId: a.orgId } });
    await assignReview(boss, input(worker.userId), NOW);

    assert.deepEqual(await completeReview(boss, ready, null, NOW), { ok: false, error: 'forbidden' });
    assert.deepEqual(await completeReview(viewer, ready, null, NOW), { ok: false, error: 'not found' });
    assert.deepEqual(await completeReview({ ...worker, orgId: b.orgId }, ready, null, NOW), { ok: false, error: 'not found' });
    assert.deepEqual(await completeReview(worker, ready, 'x'.repeat(501), NOW), { ok: false, error: 'bad note' });
    assert.deepEqual(await completeReview(worker, ready, 'tayyor', NOW), { ok: true });
    assert.deepEqual(await completeReview(worker, ready, null, NOW), { ok: false, error: 'already done' });
    assert.deepEqual(await completeReview(admin, ready, null, NOW), { ok: false, error: 'already done' });

    const row = await db.reviewAssignment.findUnique({ where: { catalogId: ready } });
    assert.equal(row?.status, 'done');
    assert.equal(row?.doneBy, worker.userId);
    assert.equal(row?.doneNote, 'tayyor');
    assert.equal(await db.auditEvent.count({ where: { orgId: a.orgId, action: 'review.completed' } }), 1);
    assert.equal(await db.notification.count({ where: { orgId: a.orgId, kind: 'review.completed', userId: boss.userId } }), 1);
    assert.equal(await unreadCount(boss), 1);
    assert.equal(await unreadCount(admin), 0);
  });

  it('an admin may close any review, and a finished one assigned again is open again', async () => {
    assert.equal((await assignReview(boss, input(worker.userId, { note: 'qayta' }), NOW)).ok, true);
    assert.equal((await db.reviewAssignment.findUnique({ where: { catalogId: ready } }))?.status, 'open');
    assert.deepEqual(await completeReview(admin, ready, null, NOW), { ok: true });
  });

  it('counts open, overdue and own reviews within the user scope; overdue is computed from the date', async () => {
    await db.reviewAssignment.deleteMany({ where: { orgId: a.orgId } });
    await assignReview(admin, input(worker.userId, { dueOn: '2026-10-21' }), NOW);
    const later = new Date('2026-10-23T05:00:00Z');
    assert.deepEqual(await reviewCounts(admin, NOW), { open: 1, overdue: 0, mine: 0 });
    assert.deepEqual(await reviewCounts(worker, later), { open: 1, overdue: 1, mine: 1 });
    assert.deepEqual(await reviewCounts(otherScope, later), { open: 0, overdue: 0, mine: 0 }, 'a client outside the scope contributes nothing');
    assert.deepEqual(await reviewCounts({ ...admin, orgId: b.orgId, clientIds: null }, later), { open: 0, overdue: 0, mine: 0 });

    const seen = await reviewsFor(worker, [ready, uploaded], later);
    assert.equal(seen.get(ready)?.overdue, true);
    assert.equal(seen.has(uploaded), false);
    assert.equal((await reviewsFor(otherScope, [ready], later)).size, 0);
  });
});

describe('notification targeting and deduplication (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let one: Person;
  let two: Person;

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    one = await makePerson(a.orgId, 'accountant');
    two = await makePerson(a.orgId, 'accountant');
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('a notice with a dedupe key is stored once per org; the same key in another org is a different notice', async () => {
    const make = (orgId: string) => notify({ orgId, kind: 'x', title: 't', body: 'b', dedupeKey: 'same', external: false });
    const first = await make(a.orgId);
    assert.ok(first);
    assert.equal(await make(a.orgId), null);
    assert.ok(await make(b.orgId));
    assert.equal(await db.notification.count({ where: { orgId: a.orgId, dedupeKey: 'same' } }), 1);
    const raced = await Promise.all([1, 2, 3, 4].map(() => notify({ orgId: a.orgId, kind: 'x', title: 't', body: 'b', dedupeKey: 'race', external: false })));
    assert.equal(raced.filter(Boolean).length, 1, 'concurrent raises collapse to one');
  });

  it('notices without a key are never merged', async () => {
    await notify({ orgId: a.orgId, kind: 'free', title: 't', body: 'b', external: false });
    await notify({ orgId: a.orgId, kind: 'free', title: 't', body: 'b', external: false });
    assert.equal(await db.notification.count({ where: { orgId: a.orgId, kind: 'free' } }), 2);
  });

  it('a personal notice is read-state and visibility private to its person', async () => {
    const id = await notify({ orgId: a.orgId, kind: 'p', title: 'only one', body: 'b', userId: one.userId });
    assert.ok(id);
    assert.equal((await listNotifications(one, { unreadOnly: true })).items.some((i) => i.id === id), true);
    assert.equal((await listNotifications(two)).items.some((i) => i.id === id), false);
    const { markRead } = await import('./notifications.js');
    assert.equal(await markRead(two, [id]), 0, 'someone else cannot even mark it read');
    assert.equal(await markRead(one, [id]), 1);
    assert.equal((await listNotifications(one, { unreadOnly: true })).items.some((i) => i.id === id), false);
  });

  it('filters by topic and marks all read for this person only', async () => {
    await db.notification.deleteMany({ where: { orgId: a.orgId } });
    await notify({ orgId: a.orgId, kind: 'review.assigned', title: 'r', body: 'b', userId: one.userId });
    await notify({ orgId: a.orgId, kind: 'catalog.ready', title: 'c', body: 'b', userId: one.userId, external: false });
    await notify({ orgId: a.orgId, kind: 'classifier.updated', title: 'o', body: 'b', external: false });
    const titles = async (group?: 'review' | 'audit' | 'other') => (await listNotifications(one, { group })).items.map((i) => i.title).sort();
    assert.deepEqual(await titles('review'), ['r']);
    assert.deepEqual(await titles('audit'), ['c']);
    assert.deepEqual(await titles('other'), ['o']);
    assert.deepEqual(await titles(), ['c', 'o', 'r']);
    assert.equal(await markAllRead(one), 3);
    assert.equal(await unreadCount(one), 0);
    assert.equal(await unreadCount(two), 1, 'the shared notice stays unread for a colleague; personal ones were never theirs');
  });

  it('the clients list never shows a personal notice as the latest news of a client', async () => {
    const client = await makeClient(a.orgId, 'Yangiliklar');
    await notify({ orgId: a.orgId, clientId: client, kind: 'classifier.updated', title: 'umumiy', body: 'b', external: false });
    await notify({ orgId: a.orgId, clientId: client, kind: 'review.assigned', title: 'shaxsiy', body: 'b', userId: one.userId });
    assert.equal((await latestPerClient(a.orgId, [client])).get(client)?.title, 'umumiy');
  });
});

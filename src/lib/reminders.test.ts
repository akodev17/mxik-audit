import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { db } from './db.js';
import { makeClient, makePerson, type Person } from './firm-test-fixtures.js';
import { localDate, nextReminderDate, skipsThisMonth } from './reminder-dates.js';
import { markDone, openTasks, reminderChats, setSchedule } from './reminders.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

// 20 October 2026, 10:00 in Tashkent.
const OCT20 = new Date('2026-10-20T05:00:00Z');

describe('reminder dates (pure)', () => {
  it('a day already past this month waits for next month instead of making an overdue task', () => {
    assert.equal(skipsThisMonth({ dayOfMonth: 5, enabled: true }, null, OCT20), true);
    assert.equal(skipsThisMonth({ dayOfMonth: 20, enabled: true }, null, OCT20), false);
    assert.equal(skipsThisMonth({ dayOfMonth: 25, enabled: true }, null, OCT20), false);
    assert.equal(skipsThisMonth({ dayOfMonth: 5, enabled: false }, null, OCT20), false);
    assert.equal(skipsThisMonth({ dayOfMonth: 5, enabled: true }, '2026-10', OCT20), false);
    assert.equal(nextReminderDate({ dayOfMonth: 5, enabled: true, lastPeriod: null }, OCT20)?.toISOString().slice(0, 10), '2026-11-05');
    assert.equal(nextReminderDate({ dayOfMonth: 25, enabled: true, lastPeriod: null }, OCT20)?.toISOString().slice(0, 10), '2026-10-25');
    assert.equal(nextReminderDate({ dayOfMonth: 25, enabled: true, lastPeriod: '2026-10' }, OCT20)?.toISOString().slice(0, 10), '2026-11-25');
    assert.equal(nextReminderDate({ dayOfMonth: 5, enabled: false, lastPeriod: null }, OCT20), null);
    assert.equal(nextReminderDate({ dayOfMonth: 5, enabled: true, lastPeriod: null }, new Date('2026-12-20T05:00:00Z'))?.toISOString().slice(0, 10), '2027-01-05');
  });

  it('uses Tashkent days: 19:30 UTC on the 31st is already the 1st', () => {
    assert.deepEqual(localDate(new Date('2026-10-31T19:30:00Z')).period, '2026-11');
  });
});

describe('reminders (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;
  let admin: Person;
  let mine = '';
  let theirs = '';

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
    admin = await makePerson(a.orgId, 'admin');
    mine = await makeClient(a.orgId, 'Meniki');
    theirs = await makeClient(a.orgId, 'Boshqaniki');
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('marking a task done checks the client is visible and writes reminder.done', async () => {
    const { period, date } = localDate(new Date());
    const task = await db.reminderTask.create({ data: { orgId: a.orgId, clientId: theirs, period, dueOn: date } });
    const accountant = await makePerson(a.orgId, 'accountant', [mine]);
    assert.deepEqual(await markDone(accountant, task.id), { ok: false, error: 'not found' });
    assert.deepEqual(await markDone({ orgId: b.orgId, userId: b.userId, clientIds: null }, task.id), { ok: false, error: 'not found' });
    assert.equal((await db.reminderTask.findUnique({ where: { id: task.id } }))?.doneAt, null);

    assert.deepEqual(await markDone(admin, task.id), { ok: true, clientId: theirs });
    assert.ok((await db.reminderTask.findUnique({ where: { id: task.id } }))?.doneAt);
    const event = await db.auditEvent.findFirst({ where: { orgId: a.orgId, action: 'reminder.done', targetId: task.id } });
    assert.ok(event);
    assert.deepEqual(await markDone(admin, task.id), { ok: false, error: 'already done' });
  });

  it('open tasks leave out archived clients and clients outside the scope', async () => {
    const { period, date } = localDate(new Date());
    const archived = await makeClient(a.orgId, 'Arxiv', { archived: true });
    await db.reminderTask.create({ data: { orgId: a.orgId, clientId: archived, period, dueOn: date } });
    await db.reminderTask.create({ data: { orgId: a.orgId, clientId: mine, period, dueOn: date } });
    assert.deepEqual((await openTasks(a.orgId, null)).map((t) => t.clientName), ['Meniki']);
    assert.deepEqual(await openTasks(a.orgId, [theirs]), []);
  });

  it('saving a schedule after its day claims this month, so no overdue task is created', async () => {
    const { day, period } = localDate(new Date());
    // Day 28 is never before today's day; day 1 is before it unless today is the 1st.
    if (day > 1) {
      const result = await setSchedule(admin, theirs, { dayOfMonth: 1, assigneeId: null, enabled: true });
      assert.ok(result.ok);
      const saved = await db.clientSchedule.findUnique({ where: { clientId: theirs } });
      assert.equal(saved?.lastPeriod, period);
      assert.ok(result.nextDue && result.nextDue > new Date());
    }
    const later = await setSchedule(admin, mine, { dayOfMonth: 28, assigneeId: null, enabled: true });
    assert.ok(later.ok);
    assert.equal((await db.clientSchedule.findUnique({ where: { clientId: mine } }))?.lastPeriod, day > 28 ? period : null);

    const viewerScoped = await makePerson(a.orgId, 'accountant', [mine]);
    assert.equal((await setSchedule(viewerScoped, theirs, { dayOfMonth: 3, assigneeId: null, enabled: true })).ok, false);
    assert.equal((await setSchedule(admin, mine, { dayOfMonth: 31, assigneeId: null, enabled: true })).ok, false);
    assert.equal((await setSchedule(admin, mine, { dayOfMonth: 3, assigneeId: b.userId, enabled: true })).ok, false);
  });

  it('Telegram falls back only to chats an admin linked, never a colleague’s', async () => {
    const accountant = await makePerson(a.orgId, 'accountant', [mine]);
    const colleague = await makePerson(a.orgId, 'accountant');
    const chat = (linkedBy: string) => db.telegramLink.create({ data: { orgId: a.orgId, chatId: `test-${Math.random().toString(36).slice(2)}`, linkedBy } });
    const colleagues = await chat(colleague.userId);
    assert.deepEqual(await reminderChats(a.orgId, [accountant.userId]), []);
    const admins = await chat(admin.userId);
    assert.deepEqual(await reminderChats(a.orgId, [accountant.userId]), [admins.chatId]);
    const own = await chat(accountant.userId);
    assert.deepEqual(await reminderChats(a.orgId, [accountant.userId]), [own.chatId]);
    assert.ok(!(await reminderChats(a.orgId, [accountant.userId])).includes(colleagues.chatId));
  });
});

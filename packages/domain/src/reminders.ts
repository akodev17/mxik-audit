// Monthly check reminders: a per-client day of month, an in-app task, and a
// Telegram message to the accountant responsible. Run from the daily cron.
import { canSeeClient } from './access.js';
import { appLink, telegramConfig } from './telegram/config.js';
import { db } from '@tasnivo/db';
import type { Result } from './decisions.js';
import { appDict } from '@tasnivo/i18n/i18n-app';
import { inEveryLocale } from './notification-text.js';
import { orgLocale } from './org-locale.js';
import { orgHasFeature } from './plan.js';
import { localDate, nextReminderDate, skipsThisMonth } from './reminder-dates.js';
import { mayWrite, type RoleCarrier } from './write-access.js';

export { localDate, nextReminderDate, skipsThisMonth };

type Who = { userId: string; orgId: string; clientIds?: string[] | null } & RoleCarrier;

export type OpenTask = { id: string; clientId: string; clientName: string; period: string; dueOn: Date; overdue: boolean };

/** Open monthly checks of clients the user may see (archived clients left out), earliest first. */
export async function openTasks(orgId: string, clientIds: string[] | null | undefined, now = new Date()): Promise<OpenTask[]> {
  const today = localDate(now).date;
  const rows = await db.reminderTask.findMany({
    where: { orgId, doneAt: null, client: { archivedAt: null }, ...(clientIds ? { clientId: { in: clientIds } } : {}) },
    orderBy: [{ dueOn: 'asc' }, { id: 'asc' }], take: 50, include: { client: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, clientId: r.clientId, clientName: r.client.name, period: r.period, dueOn: r.dueOn, overdue: r.dueOn < today }));
}

export async function getSchedule(orgId: string, clientId: string) {
  return db.clientSchedule.findFirst({ where: { orgId, clientId } });
}

export type ScheduleInput = { dayOfMonth: number; assigneeId: string | null; enabled: boolean };

/** 'assignee scope': the chosen person is limited to other clients and could not open this one. */
export type ScheduleError = 'bad day' | 'not found' | 'bad assignee' | 'assignee scope';

export async function setSchedule(who: Who, clientId: string, input: ScheduleInput, now = new Date()): Promise<{ ok: true; nextDue: Date | null } | { ok: false; error: ScheduleError }> {
  // A viewer is refused like a client out of reach, whatever the action guard did.
  if (!mayWrite(who)) return { ok: false, error: 'not found' };
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) return { ok: false, error: 'bad day' };
  const client = await db.client.findFirst({ where: { id: clientId, orgId: who.orgId }, select: { id: true } });
  if (!client || !canSeeClient(who, client.id)) return { ok: false, error: 'not found' };
  const assignee = input.assigneeId
    ? await db.user.findFirst({
      where: { id: input.assigneeId, orgId: who.orgId, role: { not: 'viewer' } },
      select: { id: true, role: true, assignments: { select: { clientId: true } } },
    })
    : null;
  if (input.assigneeId && !assignee) return { ok: false, error: 'bad assignee' };
  // Same rule as session.ts: admins and members with no assignments see every client.
  const assigneeScope = assignee && assignee.role !== 'admin' && assignee.assignments.length > 0 ? assignee.assignments.map((a) => a.clientId) : null;
  if (assignee && !canSeeClient({ clientIds: assigneeScope }, client.id)) return { ok: false, error: 'assignee scope' };

  const existing = await db.clientSchedule.findUnique({ where: { clientId }, select: { lastPeriod: true } });
  const lastPeriod = skipsThisMonth(input, existing?.lastPeriod ?? null, now) ? localDate(now).period : existing?.lastPeriod ?? null;
  const data = { dayOfMonth: input.dayOfMonth, assigneeId: assignee?.id ?? null, enabled: input.enabled, lastPeriod };
  await db.$transaction([
    db.clientSchedule.upsert({ where: { clientId }, create: { clientId, orgId: who.orgId, ...data }, update: { ...data, updatedAt: now } }),
    db.auditEvent.create({
      data: {
        orgId: who.orgId, actorId: who.userId, action: 'schedule.set', targetId: clientId,
        payload: { clientId, dayOfMonth: data.dayOfMonth, assigneeId: data.assigneeId, enabled: data.enabled },
      },
    }),
  ]);
  return { ok: true, nextDue: nextReminderDate(data, now) };
}

/** Closes an open task by hand. Only for someone who may see the task's client; recorded in the audit log. */
export async function markDone(who: Who, taskId: string): Promise<Result<{ clientId: string }>> {
  if (!mayWrite(who)) return { ok: false, error: 'not found' };
  const task = await db.reminderTask.findFirst({ where: { id: taskId, orgId: who.orgId }, select: { id: true, clientId: true, period: true, doneAt: true } });
  if (!task || !canSeeClient(who, task.clientId)) return { ok: false, error: 'not found' };
  if (task.doneAt) return { ok: false, error: 'already done' };
  const closed = await db.$transaction(async (tx) => {
    const done = await tx.reminderTask.updateMany({ where: { id: task.id, doneAt: null }, data: { doneAt: new Date() } });
    if (done.count === 0) return false;
    await tx.auditEvent.create({
      data: { orgId: who.orgId, actorId: who.userId, action: 'reminder.done', targetId: task.id, payload: { clientId: task.clientId, period: task.period } },
    });
    return true;
  });
  return closed ? { ok: true, clientId: task.clientId } : { ok: false, error: 'already done' };
}

/** A catalogue was audited for this client: its open monthly checks are done. */
export async function completeFor(clientId: string): Promise<void> {
  await db.reminderTask.updateMany({ where: { clientId, doneAt: null }, data: { doneAt: new Date() } });
}

/** Who to tell: the schedule's accountant, else the client's assigned accountants, else the admins. */
async function recipients(orgId: string, clientId: string, assigneeId: string | null): Promise<string[]> {
  if (assigneeId) return [assigneeId];
  const assigned = await db.clientAssignment.findMany({ where: { clientId, user: { orgId, role: { not: 'viewer' } } }, select: { userId: true } });
  if (assigned.length > 0) return assigned.map((a) => a.userId);
  return adminIds(orgId);
}

async function adminIds(orgId: string): Promise<string[]> {
  return (await db.user.findMany({ where: { orgId, role: 'admin' }, select: { id: true } })).map((u) => u.id);
}

/** The recipients' own chats; without any, only chats an admin linked (never a colleague's private chat). */
export async function reminderChats(orgId: string, userIds: string[]): Promise<string[]> {
  const own = await db.telegramLink.findMany({ where: { orgId, linkedBy: { in: userIds } }, select: { chatId: true } });
  if (own.length > 0) return own.map((c) => c.chatId);
  const admins = await adminIds(orgId);
  const fallback = await db.telegramLink.findMany({ where: { orgId, linkedBy: { in: admins } }, select: { chatId: true } });
  return fallback.map((c) => c.chatId);
}

async function telegram(orgId: string, userIds: string[], text: string): Promise<number> {
  const config = telegramConfig();
  if (!config.token) return 0;
  const { Api } = await import('grammy');
  const api = new Api(config.token, { apiRoot: config.apiRoot });
  let sent = 0;
  for (const chatId of await reminderChats(orgId, userIds)) {
    try { await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } }); sent += 1; } catch (error) {
      console.warn(`[reminders] telegram failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return sent;
}

/** Creates this month's tasks that are due and tells the people responsible. Safe to run many times a day. */
export async function runReminders(now = new Date()): Promise<{ created: number; messaged: number }> {
  const { period, day, date } = localDate(now);
  const schedules = await db.clientSchedule.findMany({
    where: { enabled: true, dayOfMonth: { lte: day }, client: { archivedAt: null }, OR: [{ lastPeriod: null }, { lastPeriod: { not: period } }] },
    include: { client: { select: { name: true } }, org: { select: { kind: true, deletedAt: true } } },
  });
  let created = 0;
  let messaged = 0;
  for (const s of schedules) {
    // Closed accounts get no reminders while they wait for deletion.
    if (s.org.kind !== 'customer' || s.org.deletedAt) continue;
    // A plan without monthly reminders (the free one, after a downgrade) keeps its schedule but gets none.
    if (!(await orgHasFeature(s.orgId, 'reminders'))) continue;
    const dueOn = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), s.dayOfMonth));
    const claimed = await db.clientSchedule.updateMany({ where: { clientId: s.clientId, OR: [{ lastPeriod: null }, { lastPeriod: { not: period } }] }, data: { lastPeriod: period } });
    if (claimed.count !== 1) continue;
    await db.reminderTask.upsert({ where: { clientId_period: { clientId: s.clientId, period } }, create: { orgId: s.orgId, clientId: s.clientId, period, dueOn }, update: {} });
    created += 1;

    const text = inEveryLocale((l) => ({ title: appDict(l).reminders.message(s.client.name), body: appDict(l).reminders.body }));
    const { title, body } = text[await orgLocale(s.orgId)];
    const href = `/clients/${s.clientId}`;
    const link = appLink(telegramConfig(), href);
    await db.notification.create({ data: { orgId: s.orgId, clientId: s.clientId, kind: 'reminder.monthly', title, body, text, href, telegramSentAt: new Date() } });
    messaged += await telegram(s.orgId, await recipients(s.orgId, s.clientId, s.assigneeId), link ? `${title}\n${link}` : title);
    await db.auditEvent.create({ data: { orgId: s.orgId, actorId: null, action: 'reminder.sent', targetId: s.clientId, payload: { clientId: s.clientId, period } } });
  }
  return { created, messaged };
}

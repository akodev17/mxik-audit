// Monthly check reminders: a per-client day of month, an in-app task, and a
// Telegram message to the accountant responsible. Run from the daily cron.
import { appLink, telegramConfig } from './telegram/config.js';
import { db } from './db.js';
import { appDict } from './i18n-app.js';
import { orgLocale } from './org-locale.js';

type Who = { userId: string; orgId: string };

/** Uzbekistan has no daylight saving: local time is UTC+5 all year. */
const LOCAL_OFFSET_MS = 5 * 3_600_000;

export function localDate(now: Date): { period: string; day: number; date: Date } {
  const local = new Date(now.getTime() + LOCAL_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  return { period: `${y}-${m}`, day: local.getUTCDate(), date: new Date(Date.UTC(y, local.getUTCMonth(), local.getUTCDate())) };
}

export async function overdueClientIds(orgId: string, now = new Date()): Promise<Set<string>> {
  const rows = await db.reminderTask.findMany({ where: { orgId, doneAt: null, dueOn: { lt: localDate(now).date } }, select: { clientId: true } });
  return new Set(rows.map((r) => r.clientId));
}

export type OpenTask = { id: string; clientId: string; clientName: string; dueOn: Date; overdue: boolean };

export async function openTasks(orgId: string, clientIds: string[] | null | undefined, now = new Date()): Promise<OpenTask[]> {
  const today = localDate(now).date;
  const rows = await db.reminderTask.findMany({
    where: { orgId, doneAt: null, ...(clientIds ? { clientId: { in: clientIds } } : {}) },
    orderBy: { dueOn: 'asc' }, take: 50, include: { client: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, clientId: r.clientId, clientName: r.client.name, dueOn: r.dueOn, overdue: r.dueOn < today }));
}

export async function getSchedule(orgId: string, clientId: string) {
  return db.clientSchedule.findFirst({ where: { orgId, clientId } });
}

export async function setSchedule(who: Who, clientId: string, input: { dayOfMonth: number; assigneeId: string | null; enabled: boolean }): Promise<boolean> {
  const client = await db.client.findFirst({ where: { id: clientId, orgId: who.orgId }, select: { id: true } });
  if (!client || input.dayOfMonth < 1 || input.dayOfMonth > 28) return false;
  const assignee = input.assigneeId ? await db.user.findFirst({ where: { id: input.assigneeId, orgId: who.orgId }, select: { id: true } }) : null;
  const data = { dayOfMonth: input.dayOfMonth, assigneeId: assignee?.id ?? null, enabled: input.enabled };
  await db.clientSchedule.upsert({ where: { clientId }, create: { clientId, orgId: who.orgId, ...data }, update: { ...data, updatedAt: new Date() } });
  await db.auditEvent.create({ data: { orgId: who.orgId, actorId: who.userId, action: 'schedule.set', targetId: clientId, payload: { clientId, ...data } } });
  return true;
}

export async function markDone(who: Who, taskId: string): Promise<boolean> {
  const done = await db.reminderTask.updateMany({ where: { id: taskId, orgId: who.orgId, doneAt: null }, data: { doneAt: new Date() } });
  return done.count > 0;
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
  return (await db.user.findMany({ where: { orgId, role: 'admin' }, select: { id: true } })).map((u) => u.id);
}

async function telegram(orgId: string, userIds: string[], text: string): Promise<number> {
  const config = telegramConfig();
  if (!config.token) return 0;
  const { Api } = await import('grammy');
  const api = new Api(config.token, { apiRoot: config.apiRoot });
  const own = await db.telegramLink.findMany({ where: { orgId, linkedBy: { in: userIds } }, select: { chatId: true } });
  // No chat of their own: fall back to the org's linked chats.
  const chats = own.length > 0 ? own : await db.telegramLink.findMany({ where: { orgId }, select: { chatId: true } });
  let sent = 0;
  for (const chat of chats) {
    try { await api.sendMessage(chat.chatId, text, { link_preview_options: { is_disabled: true } }); sent += 1; } catch (error) {
      console.warn(`[reminders] telegram failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return sent;
}

/** Creates this month's tasks that are due and tells the people responsible. Safe to run many times a day. */
export async function runReminders(now = new Date()): Promise<{ created: number; messaged: number }> {
  const { period, day, date } = localDate(now);
  const schedules = await db.clientSchedule.findMany({
    where: { enabled: true, dayOfMonth: { lte: day }, OR: [{ lastPeriod: null }, { lastPeriod: { not: period } }] },
    include: { client: { select: { name: true } }, org: { select: { kind: true } } },
  });
  let created = 0;
  let messaged = 0;
  for (const s of schedules) {
    if (s.org.kind !== 'customer') continue;
    const dueOn = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), s.dayOfMonth));
    const claimed = await db.clientSchedule.updateMany({ where: { clientId: s.clientId, OR: [{ lastPeriod: null }, { lastPeriod: { not: period } }] }, data: { lastPeriod: period } });
    if (claimed.count !== 1) continue;
    await db.reminderTask.upsert({ where: { clientId_period: { clientId: s.clientId, period } }, create: { orgId: s.orgId, clientId: s.clientId, period, dueOn }, update: {} });
    created += 1;

    const ta = appDict(await orgLocale(s.orgId));
    const title = ta.reminders.message(s.client.name);
    const href = `/clients/${s.clientId}`;
    const link = appLink(telegramConfig(), href);
    await db.notification.create({ data: { orgId: s.orgId, clientId: s.clientId, kind: 'reminder.monthly', title, body: ta.reminders.body, href, telegramSentAt: new Date() } });
    messaged += await telegram(s.orgId, await recipients(s.orgId, s.clientId, s.assigneeId), link ? `${title}\n${link}` : title);
    await db.auditEvent.create({ data: { orgId: s.orgId, actorId: null, action: 'reminder.sent', targetId: s.clientId, payload: { clientId: s.clientId, period } } });
  }
  return { created, messaged };
}

// Monthly check reminders as the web (client page, server actions) and the API both serve them.
// Error texts come back in the user's language, as the actions returned them.
import { i18nFor } from '@tasnivo/i18n/locale';
import type { Locale } from '@tasnivo/i18n/i18n';
import { db } from '@tasnivo/db';
import { canSeeClient } from './access.js';
import { isDemoOrg } from './demo.js';
import { orgHasFeature } from './plan.js';
import { getSchedule, markDone, setSchedule } from './reminders.js';
import type { RoleCarrier } from './write-access.js';

type Who = { userId: string; orgId: string; clientIds?: string[] | null } & RoleCarrier;

export type ScheduleView = { clientId: string; dayOfMonth: number; assigneeId: string | null; enabled: boolean; lastPeriod: string | null; updatedAt: Date };

/** A client's schedule, null when none was set; undefined when the client is not one the user may see. */
export async function scheduleFor(user: Who, clientId: string): Promise<ScheduleView | null | undefined> {
  if (!canSeeClient(user, clientId)) return undefined;
  const client = await db.client.findFirst({ where: { id: clientId, orgId: user.orgId }, select: { id: true } });
  if (!client) return undefined;
  const s = await getSchedule(user.orgId, client.id);
  return s ? { clientId: s.clientId, dayOfMonth: s.dayOfMonth, assigneeId: s.assigneeId, enabled: s.enabled, lastPeriod: s.lastPeriod, updatedAt: s.updatedAt } : null;
}

export type ReminderResult = { ok: true; nextDue?: string | null } | { ok: false; error: string };

/** Day of month (1–28), assignee and on/off of a client's monthly check. */
export async function saveClientSchedule(
  user: Who, clientId: string, input: { dayOfMonth: number; assigneeId: string | null; enabled: boolean }, locale: Locale,
): Promise<ReminderResult> {
  const { ta } = i18nFor(locale);
  const words = ta.firmX.reminders;
  // A demo org never changes schedules, whichever layer in front refused it already.
  if (await isDemoOrg(user.orgId)) return { ok: false, error: ta.firmX.errors.forbidden };
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) return { ok: false, error: words.badDay };
  if (!canSeeClient(user, clientId)) return { ok: false, error: ta.firmX.errors['not found'] };
  // Switching reminders off is always allowed; switching them on needs a plan that has them.
  if (input.enabled && !(await orgHasFeature(user.orgId, 'reminders'))) return { ok: false, error: ta.prX.notInPlan(ta.prX.features.reminders) };
  const result = await setSchedule(user, clientId, input);
  if (!result.ok) {
    return { ok: false, error: result.error === 'bad day' ? words.badDay : result.error === 'assignee scope' ? words.assigneeScope : ta.firmX.errors['not found'] };
  }
  return { ok: true, nextDue: result.nextDue ? result.nextDue.toISOString() : null };
}

/** Marks a monthly check done by hand (never in a demo org); `clientId` tells the web which pages to refresh. */
export async function finishReminderTask(user: Who, taskId: string, locale: Locale): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  const { ta } = i18nFor(locale);
  if (await isDemoOrg(user.orgId)) return { ok: false, error: ta.firmX.errors.forbidden };
  const result = await markDone(user, taskId);
  if (!result.ok) return { ok: false, error: result.error === 'already done' ? ta.firmX.reminders.alreadyDone : ta.firmX.errors['not found'] };
  return { ok: true, clientId: result.clientId };
}

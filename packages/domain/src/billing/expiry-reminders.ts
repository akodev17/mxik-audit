// Trial and subscription expiry reminders (plan D9), run by the daily job: 7, 3 and 1 days before
// the end and on the day itself, in Tashkent days. One in-app notice per org and threshold (the
// Notification dedupeKey decides, so a re-run or a second worker sends nothing twice) and an e-mail
// to each of the org's admins. A threshold missed because the job did not run goes out on the next
// run before the following one. No grace period: the gates close at the end as before.
import { db } from '@tasnivo/db';
import { fmtDate } from '@tasnivo/i18n/format';
import { parseLocale, type Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { absoluteUrl } from '../app-url';
import { jobs } from '../jobs/dispatcher';
import { inEveryLocale } from '../notification-text';
import { notify } from '../notifications';
import { orgLocale } from '../org-locale';
import { localDate } from '../reminder-dates';
import { isReservedEmail } from '../security/reserved-email';

export const REMINDER_DAYS = [7, 3, 1, 0] as const;
export type ExpiryKind = 'trial' | 'subscription';

const DAY = 86_400_000;
/** Uzbekistan is UTC+5 all year (reminder-dates.ts). */
const LOCAL_OFFSET_MS = 5 * 3_600_000;
const PLAN_HREF = '/settings?tab=plan';

/** The end that closes the org's access: the later of its trial and its paid period (a payment past the trial wins). */
export function accessEnd(org: { trialEndsAt: Date | null; subscriptionUntil: Date | null }): { kind: ExpiryKind; end: Date } | null {
  const { trialEndsAt: trial, subscriptionUntil: paid } = org;
  if (paid && (!trial || paid >= trial)) return { kind: 'subscription', end: paid };
  return trial ? { kind: 'trial', end: trial } : null;
}

/** Whole Tashkent calendar days from `now` to `end` (0 = it ends today; negative = it ended before today). */
export function daysUntil(end: Date, now: Date): number {
  return Math.round((localDate(end).date.getTime() - localDate(now).date.getTime()) / DAY);
}

const localDay = (d: Date): string => localDate(d).date.toISOString().slice(0, 10);

/**
 * The threshold a run owes with `days` left: today's own, or on a day between thresholds the last
 * one passed (a day the job did not run), so "3 days" missed goes out on day 2. Only that one, never
 * an earlier one; null outside the window. Whether it was already sent is the dedupe key's call.
 */
export function owedThreshold(days: number): number | null {
  if (days < 0 || days > Math.max(...REMINDER_DAYS)) return null;
  return Math.min(...REMINDER_DAYS.filter((t) => t >= days));
}

export type ExpiryRun = { notified: number; mailed: number; failed: number };

/** Sends the reminders due today. Safe to run any number of times a day. */
export async function sendExpiryReminders(now = new Date()): Promise<ExpiryRun> {
  // From today's local midnight to the end of the 7th day after it.
  const from = new Date(localDate(now).date.getTime() - LOCAL_OFFSET_MS);
  const to = new Date(from.getTime() + (Math.max(...REMINDER_DAYS) + 1) * DAY);
  const window = { gte: from, lt: to };
  // Demo copies, the demo template and internal orgs have no plan; closed accounts wait for deletion.
  const orgs = await db.organization.findMany({
    where: { kind: 'customer', deletedAt: null, OR: [{ trialEndsAt: window }, { subscriptionUntil: window }] },
    select: { id: true, name: true, trialEndsAt: true, subscriptionUntil: true },
  });
  const run: ExpiryRun = { notified: 0, mailed: 0, failed: 0 };
  for (const org of orgs) {
    // A trial inside the window is skipped when a payment already runs past it.
    const due = accessEnd(org);
    if (!due || due.end < from || due.end >= to) continue;
    const days = daysUntil(due.end, now);
    const threshold = owedThreshold(days);
    if (threshold === null) continue;
    try {
      const mailed = await remind(org, due.kind, due.end, days, threshold);
      if (mailed === null) continue;
      run.notified += 1;
      run.mailed += mailed;
    } catch (error) {
      // One org's failure (a queue that is down) never stops the others.
      run.failed += 1;
      console.warn(`[expiry-reminders] org ${org.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return run;
}

function text(locale: Locale, kind: ExpiryKind, end: Date, days: number): { title: string; body: string } {
  const x = i18nFor(locale).ta.setX.expiry;
  return { title: x.title(kind, days), body: x.body(fmtDate(locale, end)) };
}

/**
 * The notice (once per org, end date and threshold), then one e-mail per admin: how many were handed
 * over, null when already sent. The words count the days actually left, also on a caught-up day.
 */
async function remind(org: { id: string; name: string }, kind: ExpiryKind, end: Date, days: number, threshold: number): Promise<number | null> {
  const texts = inEveryLocale((l) => text(l, kind, end, days));
  const { title, body } = texts[await orgLocale(org.id)];
  const id = await notify({
    orgId: org.id, kind: 'billing.expiring', title, body, text: texts, href: PLAN_HREF,
    // Kind, org (the unique index is per org) and day: a renewal moves the end date, so its reminders start afresh.
    dedupeKey: `billing.expiring:${kind}:${localDay(end)}:${threshold}`,
    external: false,
  });
  if (id === null) return null;
  const admins = await db.user.findMany({ where: { orgId: org.id, role: 'admin' }, select: { email: true, locale: true } });
  let mailed = 0;
  for (const admin of admins) {
    // Telegram-only and demo accounts have a placeholder address nobody reads.
    if (isReservedEmail(admin.email)) continue;
    const locale = parseLocale(admin.locale);
    const x = i18nFor(locale).ta.setX.expiry;
    const t = texts[locale];
    await jobs().enqueueMail({ to: admin.email, subject: x.mailSubject(t.title), text: x.mailBody(org.name, t.title, t.body, absoluteUrl(PLAN_HREF)) });
    mailed += 1;
  }
  return mailed;
}

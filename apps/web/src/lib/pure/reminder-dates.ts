// Calendar maths for monthly check reminders in Tashkent time (domain reminder-dates.ts), so the
// schedule form shows the same next date the server will use.

/** Uzbekistan has no daylight saving: local time is UTC+5 all year. */
const LOCAL_OFFSET_MS = 5 * 3_600_000;

export function localDate(now: Date): { period: string; day: number; date: Date } {
  const local = new Date(now.getTime() + LOCAL_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  return { period: `${y}-${m}`, day: local.getUTCDate(), date: new Date(Date.UTC(y, local.getUTCMonth(), local.getUTCDate())) };
}

/** True when saving now would make the cron create a task already overdue: the first task then waits a month. */
export function skipsThisMonth(input: { dayOfMonth: number; enabled: boolean }, lastPeriod: string | null, now = new Date()): boolean {
  const { period, day } = localDate(now);
  return input.enabled && input.dayOfMonth < day && lastPeriod !== period;
}

/** The day the next task will be due, or null when reminders are off. */
export function nextReminderDate(s: { dayOfMonth: number; enabled: boolean; lastPeriod: string | null }, now = new Date()): Date | null {
  if (!s.enabled) return null;
  const { period, day, date } = localDate(now);
  const nextMonth = s.lastPeriod === period || s.dayOfMonth < day;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + (nextMonth ? 1 : 0), s.dayOfMonth));
}

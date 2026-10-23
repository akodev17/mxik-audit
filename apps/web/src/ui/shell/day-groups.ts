// Lists that read as a timeline (notifications, the activity log) group their entries by calendar day in
// Tashkent, newest first as given. Pure: `now` comes from the caller, so server and browser agree.
import { isoDay } from '@tasnivo/i18n/format';

export type DayName = 'today' | 'yesterday' | null;
export type DayGroup<T> = { day: string; name: DayName; items: T[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Consecutive entries of one day form a group; `name` is today or yesterday when it is one of those. */
export function groupByDay<T>(items: readonly T[], at: (item: T) => Date | string | number, now: Date | number): DayGroup<T>[] {
  const today = isoDay(now);
  // Tashkent has no daylight saving, so a day back is always 24 hours.
  const yesterday = isoDay(new Date(new Date(now).getTime() - DAY_MS));
  const groups: DayGroup<T>[] = [];
  for (const item of items) {
    const day = isoDay(at(item));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, name: day === today ? 'today' : day === yesterday ? 'yesterday' : null, items: [item] });
  }
  return groups;
}

/** "14:05" of a date-time in Tashkent, from the shared formatter. */
export function timeOfDay(dateTime: string): string {
  return dateTime.slice(dateTime.indexOf(' ') + 1);
}

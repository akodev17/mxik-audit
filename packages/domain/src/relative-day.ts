// "3 kun oldin": how long ago a date was, counted in Tashkent calendar days. Pure.
import { isoDay } from '@tasnivo/i18n/format';

/** Whole Tashkent calendar days from the date to now; 0 = today, never negative. */
export function daysSince(value: Date, now = new Date()): number {
  const from = Date.parse(isoDay(value));
  const to = Date.parse(isoDay(now));
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export type AgoWords = { today: string; yesterday: string; days: (n: number) => string; months: (n: number) => string };

export function agoText(words: AgoWords, days: number): string {
  if (days <= 0) return words.today;
  if (days === 1) return words.yesterday;
  if (days < 60) return words.days(days);
  return words.months(Math.floor(days / 30));
}

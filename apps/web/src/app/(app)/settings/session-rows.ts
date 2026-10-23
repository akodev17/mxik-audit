// The "last active" wording of the sessions list (the API answers the rows in order). Pure, so it is
// tested without a database.
import type { Locale } from '@tasnivo/i18n/i18n';

type Unit = 'minute' | 'hour' | 'day';

const STEPS: [Unit, number][] = [['minute', 60], ['hour', 24], ['day', 30]];

/**
 * Uzbek is spelled out here: Chromium and Edge ship no Uzbek relative-time data, so
 * `Intl.RelativeTimeFormat('uz')` falls back to the root locale ("-1 min", "yesterday") (B3).
 */
const UZ: { now: string } & Record<Unit, (n: number) => string> = {
  now: 'hozir',
  minute: (n) => `${n} daqiqa oldin`,
  hour: (n) => `${n} soat oldin`,
  day: (n) => (n === 1 ? 'kecha' : `${n} kun oldin`),
};

/** "5 daqiqa oldin" / "5 минут назад"; under a minute is "hozir" / "сейчас"; null past 30 days (show the date instead). */
export function agoLabel(locale: Locale, at: Date | string, now: Date = new Date()): string | null {
  const format = locale === 'uz' ? null : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  if (value === 0) return format ? format.format(0, 'second') : UZ.now;
  for (const [unit, next] of STEPS) {
    if (value < next) return format ? format.format(-value, unit) : UZ[unit](value);
    value = Math.floor(value / next);
  }
  return null;
}

/** Sessions listed before "show all" (B21: the seed user had 50+). */
export const SESSIONS_SHOWN = 10;

/** The rows on screen: every one when asked, else this device and the most recent others, in their order. */
export function shownSessions<T extends { current: boolean }>(rows: readonly T[], all: boolean, limit = SESSIONS_SHOWN): T[] {
  if (all || rows.length <= limit) return [...rows];
  const current = rows.filter((row) => row.current);
  const others = rows.filter((row) => !row.current).slice(0, Math.max(0, limit - current.length));
  return rows.filter((row) => row.current || others.includes(row));
}

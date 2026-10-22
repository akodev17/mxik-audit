// The "last active" wording of the sessions list (the API answers the rows in order). Pure, so it is
// tested without a database.
import type { Locale } from '@tasnivo/i18n/i18n';

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [['minute', 60], ['hour', 24], ['day', 30]];

/** "5 daqiqa oldin" / "5 минут назад"; under a minute is "hozir" / "сейчас"; null past 30 days (show the date instead). */
export function agoLabel(locale: Locale, at: Date | string, now: Date = new Date()): string | null {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  if (value === 0) return format.format(0, 'second');
  for (const [unit, next] of STEPS) {
    if (value < next) return format.format(-value, unit);
    value = Math.floor(value / next);
  }
  return null;
}

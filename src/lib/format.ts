// Locale-aware number and date formatting for both server and client code.
// Dates are always shown in Uzbekistan time, whatever the server's TZ.
import type { Locale } from './i18n';

export const APP_TIME_ZONE = 'Asia/Tashkent';

/**
 * Both languages group thousands with a no-break space and use a decimal comma ("1 234 567,5").
 * The separators are fixed here rather than taken from ICU: browsers ship different locale data
 * (Chromium formats uz-UZ as "1,234.5", Node as "1 234,5"), and a server-rendered number that the
 * client formats differently breaks hydration (React #418).
 */
const GROUP = '\u00a0';
const DECIMAL = ',';

function withFixedSeparators(parts: Intl.NumberFormatPart[], percentSign: string): string {
  return parts.map((p) => (p.type === 'group' ? GROUP : p.type === 'decimal' ? DECIMAL : p.type === 'percentSign' ? percentSign : p.value)).join('');
}

/** Digits come from en-US, which every runtime has; only the separators are localised. */
export function fmtNumber(_locale: Locale, value: number, options: Intl.NumberFormatOptions = {}): string {
  return withFixedSeparators(new Intl.NumberFormat('en-US', { maximumFractionDigits: options.minimumFractionDigits ?? 0, ...options }).formatToParts(value), '%');
}

/** 20.10.2026 in both languages (Uzbek and Russian accountants use day.month.year). */
export function fmtDate(_locale: Locale, value: Date | string | number): string {
  const d = new Date(value);
  // Only the numeric parts are used, so a locale every runtime has keeps server and browser equal.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

/** 20.10.2026 14:05 (24-hour clock; h23 so midnight is 00, never 24). */
export function fmtDateTime(locale: Locale, value: Date | string | number): string {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${fmtDate(locale, d)} ${get('hour')}:${get('minute')}`;
}

/** 42% in Uzbek, 42 % in Russian (a no-break space before the sign). */
export function fmtPercent(locale: Locale, ratio: number, options: Intl.NumberFormatOptions = {}): string {
  const parts = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: options.minimumFractionDigits ?? 0, ...options }).formatToParts(ratio);
  return withFixedSeparators(parts, locale === 'ru' ? `${GROUP}%` : '%');
}

/** The calendar day in Tashkent as YYYY-MM-DD, for date inputs and period keys. */
export function isoDay(value: Date | string | number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  return parts;
}

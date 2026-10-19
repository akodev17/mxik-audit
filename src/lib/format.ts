// Locale-aware number and date formatting for both server and client code.
// Dates are always shown in Uzbekistan time, whatever the server's TZ.
import type { Locale } from './i18n';

export const APP_TIME_ZONE = 'Asia/Tashkent';

const tag = (locale: Locale): string => (locale === 'ru' ? 'ru-RU' : 'uz-UZ');

export function fmtNumber(locale: Locale, value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0, ...options }).format(value);
}

/** 20.10.2026 in both languages (Uzbek and Russian accountants use day.month.year). */
export function fmtDate(locale: Locale, value: Date | string | number): string {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat(tag(locale), { timeZone: APP_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}

/** 20.10.2026 14:05 */
export function fmtDateTime(locale: Locale, value: Date | string | number): string {
  const d = new Date(value);
  const time = new Intl.DateTimeFormat(tag(locale), { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${fmtDate(locale, d)} ${time}`;
}

export function fmtPercent(locale: Locale, ratio: number): string {
  return new Intl.NumberFormat(tag(locale), { style: 'percent', maximumFractionDigits: 0 }).format(ratio);
}

/** The calendar day in Tashkent as YYYY-MM-DD, for date inputs and period keys. */
export function isoDay(value: Date | string | number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
  return parts;
}

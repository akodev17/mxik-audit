// Statement dates as `YYYY-MM-DD`: "01.10.2026", "1/10/26", "2026-10-01", "01.10.2026 14:05:00",
// Excel serial numbers (45931) and the ISO dates the xlsx reader makes of date cells. A text
// that is not one of these is invalid, never guessed. Pure; shared with the browser.

export type DateOrder = 'dmy' | 'ymd' | 'mdy';
export type DateRead = { value: string | null; invalid: boolean };

const EMPTY: DateRead = { value: null, invalid: false };
const INVALID: DateRead = { value: null, invalid: true };

/** Years a bank statement can plausibly carry; anything else is a misread number. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
/** Excel serials of 1990-01-01 and 2100-12-31 (1900 date system). */
const MIN_SERIAL = 32874;
const MAX_SERIAL = 73415;

const pad = (n: number): string => String(n).padStart(2, '0');

export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1) return null;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day > days ? null : `${year}-${pad(month)}-${pad(day)}`;
}

/** Excel's 1900 date system: day 1 is 1900-01-01 and the phantom 1900-02-29 is counted, hence the 1899-12-30 epoch. */
export function fromSerial(serial: number): string | null {
  if (!(serial >= MIN_SERIAL && serial <= MAX_SERIAL)) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const TIME = String.raw`(?:[ T,]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const ISO = new RegExp(String.raw`^(\d{4})[-./](\d{1,2})[-./](\d{1,2})${TIME}$`);
const SHORT = new RegExp(String.raw`^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})(?:\s*(?:г\.?|y\.?|yil))?${TIME}$`, 'u');

/**
 * Reads a date cell. A four-digit year first is always year-month-day; otherwise `order` says
 * whether 01.02.2026 is the 1st of February (`dmy`, Uzbek and Russian banks) or January 2nd.
 */
export function readDate(raw: string | null | undefined, order: DateOrder = 'dmy'): DateRead {
  if (raw === null || raw === undefined) return EMPTY;
  const text = raw.trim();
  if (text === '') return EMPTY;
  const iso = ISO.exec(text);
  if (iso) {
    const value = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return value ? { value, invalid: false } : INVALID;
  }
  const short = SHORT.exec(text);
  if (short) {
    const a = Number(short[1]);
    const b = Number(short[2]);
    const yearText = short[3] ?? '';
    const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    const [day, month] = order === 'mdy' ? [b, a] : [a, b];
    const value = isoDate(year, month, day);
    return value ? { value, invalid: false } : INVALID;
  }
  if (/^\d{5}(?:\.\d+)?$/.test(text)) {
    const value = fromSerial(Number(text));
    return value ? { value, invalid: false } : INVALID;
  }
  return INVALID;
}

/** Every dd.mm.yyyy (or yyyy-mm-dd) date written inside a longer text, in order (a title's period). */
export function datesIn(text: string, order: DateOrder = 'dmy'): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/g)) {
    const read = readDate(m[0], order);
    if (read.value) out.push(read.value);
  }
  return out;
}

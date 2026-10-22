// The activity date filters are typed as dd.mm.yyyy, the way the rest of the app shows dates.
// Older links carry yyyy-mm-dd, so both are read; everything else is reported as unreadable.

const DOTTED = /^(\d{1,2})[.,/\-\s](\d{1,2})[.,/\-\s](\d{4})$/;
const DIGITS = /^(\d{2})(\d{2})(\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 9999) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > last) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A typed day as yyyy-mm-dd; '' when empty, null when it cannot be read as a real calendar day. */
export function parseDayInput(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  if (!text) return '';
  const isoMatch = ISO.exec(text);
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  const m = DOTTED.exec(text) ?? DIGITS.exec(text);
  return m ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** yyyy-mm-dd back to dd.mm.yyyy for the input. */
export function dayInputValue(isoDay: string): string {
  const m = ISO.exec(isoDay);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}

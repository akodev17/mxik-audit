// Money in bank statements as exact decimal strings: read as the bank wrote it ("1 234 567,89",
// "1234567.89", "1'234'567.89", "(1 000,00)") and added up without floating point, so a
// statement's balance check is exact to the tiyin. Pure; shared with the browser.

export type DecimalMark = 'auto' | 'comma' | 'dot';

export type DecimalRead = {
  /** Canonical decimal string (`-1234567.89`, no thousands separators, `.` as the mark); null when empty or unreadable. */
  value: string | null;
  /** The cell had text that is not a number. */
  invalid: boolean;
  /** One separator followed by exactly three digits ("12,500"): read as thousands, but it could be a fraction. */
  ambiguous: boolean;
};

const EMPTY: DecimalRead = { value: null, invalid: false, ambiguous: false };
const INVALID: DecimalRead = { value: null, invalid: true, ambiguous: false };

/** Fraction digits kept (accounting.DecimalString allows six). */
export const SCALE = 6;

/** Currency words a bank may print next to an amount; dropped before reading the number. */
const CURRENCY_WORDS = /(uzs|usd|eur|rub|сум|сўм|so['ʻʼ’‘`]?m|руб\.?|долл\.?|\$|€)/giu;

/** Thousands separators besides a plain space: no-break, narrow no-break and thin spaces, apostrophes. */
const GROUPING = /[\s\u00a0\u202f\u2009'ʼ’‘`]/gu;

function canonical(negative: boolean, whole: string, fraction: string): DecimalRead {
  const w = whole.replace(/^0+(?=\d)/, '') || '0';
  const f = fraction.replace(/0+$/, '');
  if (f.length > SCALE) return INVALID;
  const text = f ? `${w}.${f}` : w;
  return { value: negative && text !== '0' ? `-${text}` : text, invalid: false, ambiguous: false };
}

/**
 * Reads one amount cell. `mark` is the file's decimal mark when known; `auto` decides per cell:
 * with both separators the last one is the mark, a separator repeated is thousands grouping, and
 * a single one is the mark unless exactly three digits follow a 1–3 digit whole part (ambiguous).
 */
export function readDecimal(raw: string | null | undefined, mark: DecimalMark = 'auto'): DecimalRead {
  if (raw === null || raw === undefined) return EMPTY;
  let text = raw.trim();
  if (text === '' || text === '-' || text === '—') return EMPTY;
  let negative = false;
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1); }
  text = text.replace(CURRENCY_WORDS, '').replace(GROUPING, '');
  if (/^[-−–]/.test(text)) { negative = !negative; text = text.slice(1); }
  if (/[-−–]$/.test(text)) { negative = !negative; text = text.slice(0, -1); }
  if (text.startsWith('+')) text = text.slice(1);
  if (text === '') return INVALID;
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return INVALID;

  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  // A number cell of an .xlsx always reaches us as "1234567.89" whatever the file's convention, so
  // a lone separator of the other kind that cannot be grouping (not three digits after it) is the mark.
  const lone = (sep: string): boolean => {
    const at = text.indexOf(sep);
    return at >= 0 && at === text.lastIndexOf(sep) && text.length - at - 1 !== 3;
  };
  if (mark === 'comma' && commas === 0 && lone('.')) mark = 'dot';
  else if (mark === 'dot' && dots === 0 && lone(',')) mark = 'comma';
  if (mark === 'comma') {
    if (commas > 1) return INVALID;
    const [whole = '', fraction = ''] = text.replace(/\./g, '').split(',');
    return whole === '' && fraction === '' ? INVALID : canonical(negative, whole, fraction);
  }
  if (mark === 'dot') {
    if (dots > 1) return INVALID;
    const [whole = '', fraction = ''] = text.replace(/,/g, '').split('.');
    return whole === '' && fraction === '' ? INVALID : canonical(negative, whole, fraction);
  }
  if (commas > 0 && dots > 0) {
    const last = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
    const markChar = text[last];
    const before = text.slice(0, last);
    // The mark appears once; the other separator only groups thousands.
    if (before.includes(markChar ?? '')) return INVALID;
    return canonical(negative, before.replace(/[.,]/g, ''), text.slice(last + 1));
  }
  if (commas + dots > 1) {
    const groups = text.split(/[.,]/);
    // "1,234,567" groups thousands; "1.2.3" is not a number.
    if (groups.slice(1).some((g) => g.length !== 3)) return INVALID;
    return canonical(negative, groups.join(''), '');
  }
  if (commas + dots === 1) {
    const [whole = '', fraction = ''] = text.split(/[.,]/);
    if (fraction.length === 3 && /^[1-9]\d{0,2}$/.test(whole)) {
      const read = canonical(negative, `${whole}${fraction}`, '');
      return { ...read, ambiguous: true };
    }
    return canonical(negative, whole, fraction);
  }
  return canonical(negative, text, '');
}

// ── Exact arithmetic on canonical strings ──────────────────────────────────────────────────

const UNIT = 10n ** BigInt(SCALE);

/** Canonical decimal string → integer millionths. */
export function toUnits(value: string): bigint {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const units = BigInt(whole) * UNIT + BigInt((fraction + '0'.repeat(SCALE)).slice(0, SCALE));
  return negative ? -units : units;
}

/** Integer millionths → canonical decimal string. */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = (abs / UNIT).toString();
  const fraction = (abs % UNIT).toString().padStart(SCALE, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && text !== '0' ? `-${text}` : text;
}

export const addDecimals = (...values: readonly string[]): string => fromUnits(values.reduce((sum, v) => sum + toUnits(v), 0n));
export const subDecimals = (a: string, b: string): string => fromUnits(toUnits(a) - toUnits(b));
export const negateDecimal = (value: string): string => fromUnits(-toUnits(value));
export const isZeroDecimal = (value: string): boolean => toUnits(value) === 0n;
export const isNegativeDecimal = (value: string): boolean => toUnits(value) < 0n;
export const absDecimal = (value: string): string => (isNegativeDecimal(value) ? negateDecimal(value) : value);
export const sameDecimal = (a: string, b: string): boolean => toUnits(a) === toUnits(b);

/** "1234567.8" → "1 234 567.80" style for screens and CSV: grouped whole part, two fraction digits at least. */
export function formatDecimal(value: string, group = ' ', mark = '.'): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? '-' : ''}${grouped}${mark}${fraction.padEnd(2, '0')}`;
}

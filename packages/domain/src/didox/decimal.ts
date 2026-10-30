// Money and quantities from Didox documents without float arithmetic. Values arrive as numbers,
// strings and noisy floats (`892.8600000000000136`, `0.30000000000000004`); each is read once into
// a BigInt of millionths (the contract's DecimalString allows six fraction digits) and every sum,
// product and comparison happens on those integers. decimal.js is not a dependency of the repo, so
// this is the small subset the invoice checks need.

/** Millionths: 1.5 → 1_500_000n. */
export type Micros = bigint;

const SCALE = 1_000_000n;
const DIGITS = 6;

/**
 * Reads a decimal from a JSON value: a number, or a string with `.` or `,` as the decimal mark and
 * spaces (also non-breaking) as thousands separators. Rounds half away from zero to six fraction
 * digits, which folds the float noise Didox sends (`892.8600000000000136` → 892.86). Null for
 * anything that is not a finite decimal (empty, `null`, `"abc"`, `NaN`).
 */
export function readDecimal(value: unknown): Micros | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // Shortest round-trip form; exponent forms (1e-7, 1e21) go through toFixed.
    text = String(value);
    if (/e/i.test(text)) text = Math.abs(value) < 1 ? value.toFixed(DIGITS + 2) : BigInt(Math.round(value)).toString();
  } else if (typeof value === 'string') {
    text = value.trim().replace(/[\s\u00a0\u202f]/g, '');
    // "1234,56" → "1234.56"; with both marks the last one is the decimal mark: "1,234.56" and "1.234,56" are both
    // 1234.56 (the second was read as 1.23456; review 30 Oct, R-D9).
    if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
    else if (text.includes(',') && text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else {
    return null;
  }
  const m = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (!m[2] && !m[3])) return null;
  const negative = m[1] === '-';
  const whole = BigInt(m[2] || '0');
  const fraction = m[3] ?? '';
  let micros = whole * SCALE + BigInt((fraction.slice(0, DIGITS) || '0').padEnd(DIGITS, '0'));
  // Half away from zero on the seventh digit.
  if ((fraction[DIGITS] ?? '0') >= '5') micros += 1n;
  return negative ? -micros : micros;
}

/** The contract's DecimalString: no exponent, no trailing zeros, at most six fraction digits. */
export function toDecimalString(micros: Micros): string {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(DIGITS, '0').replace(/0+$/, '');
  const text = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative && text !== '0' ? `-${text}` : text;
}

/** readDecimal then toDecimalString; null for an unreadable value. */
export function normalizeDecimal(value: unknown): string | null {
  const micros = readDecimal(value);
  return micros === null ? null : toDecimalString(micros);
}

export const sum = (values: readonly Micros[]): Micros => values.reduce((a, b) => a + b, 0n);

/** a × b, rounded half away from zero to millionths. */
export function multiply(a: Micros, b: Micros): Micros {
  const product = a * b;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + SCALE / 2n) / SCALE;
  return negative ? -rounded : rounded;
}

/** a × percent / 100 (VAT from a rate in percent). */
export function percentOf(a: Micros, percent: Micros): Micros {
  const product = a * percent;
  const divisor = SCALE * 100n;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + divisor / 2n) / divisor;
  return negative ? -rounded : rounded;
}

/** Rounds to `digits` fraction digits (2 for money in UZS tiyin). */
export function roundTo(micros: Micros, digits: number): Micros {
  const step = 10n ** BigInt(DIGITS - digits);
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = ((abs + step / 2n) / step) * step;
  return negative ? -rounded : rounded;
}

export const absDiff = (a: Micros, b: Micros): Micros => (a > b ? a - b : b - a);

/** Whole units → micros (tolerances: `units(1)` is one sum). */
export const units = (n: number): Micros => BigInt(Math.round(n * 1_000_000));

/** Micros → whole tiyin (1/100 sum), half away from zero: the unit the roaming arithmetic works in. */
export function tiyin(micros: Micros): bigint {
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const rounded = (abs + 5_000n) / 10_000n;
  return negative ? -rounded : rounded;
}

/**
 * How many fraction digits a value was written with, trailing zeros and float noise left out:
 * `892.86`, `"892.8600000000000136"` and `892.8599999999999` are 2, `"10000000.00"` is 0,
 * `"0.123456789"` is 9. Null for anything readDecimal would refuse. Didox's limits (count ≤ 6,
 * money ≤ 2, research note §5 V5) are checked against this, not against the parsed micros.
 */
export function fractionDigits(value: unknown): number | null {
  if (readDecimal(value) === null) return null;
  let text = typeof value === 'number' ? String(value) : String(value).trim().replace(/[\s\u00a0\u202f]/g, '');
  if (/e/i.test(text)) text = Number(text).toFixed(12);
  if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
  const fraction = text.split('.')[1] ?? '';
  // A run of six zeros or nines is the binary float's tail, not a written digit.
  const noise = /0{6,}|9{6,}/.exec(fraction);
  let digits = noise ? fraction.slice(0, noise.index) : fraction;
  if (noise && noise[0].startsWith('9')) {
    // 0.2999999 is 0.3: the digit before the nines rounds up and the zeros it leaves behind drop.
    digits = digits.replace(/9+$/, '');
    if (digits.length > 0) digits = digits.slice(0, -1) + String(Number(digits.slice(-1)) + 1);
  }
  return digits.replace(/0+$/, '').length;
}

/** A number written with a thousands separator or a decimal comma: Didox and the roaming centre send neither (§5 "dot separator"). */
export const looseNumberFormat = (value: unknown): boolean => typeof value === 'string' && /[,\s\u00a0\u202f']/.test(value.trim());

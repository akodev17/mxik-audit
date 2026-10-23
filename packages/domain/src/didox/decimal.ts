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
    // "1234,56" → "1234.56"; "1,234.56" keeps the dot as the mark and drops the comma.
    if (text.includes(',') && !text.includes('.')) text = text.replace(',', '.');
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

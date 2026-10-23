// Exact arithmetic on the contract's decimal strings (accounting.DecimalString: at most 6 fraction
// digits). Money never goes through a float between the statement and the 1C file. Pure.

const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);

/** "1234.5" → 1234500000n (micro-units); null when the text is not a decimal string. */
export function toMicros(text: string | null | undefined): bigint | null {
  if (text === null || text === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) return null;
  const [, sign = '', whole = '0', fraction = ''] = m;
  const value = BigInt(whole) * FACTOR + BigInt(fraction.padEnd(SCALE, '0') || '0');
  return sign === '-' ? -value : value;
}

/** Micro-units → the shortest decimal string with at least `minFraction` fraction digits. */
export function fromMicros(value: bigint, minFraction = 0): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / FACTOR;
  let fraction = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  if (fraction.length < minFraction) fraction = fraction.padEnd(minFraction, '0');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Money as 1C's bank exchange writes it: a dot and exactly two decimals ("1500.00"). */
export function money2(text: string): string {
  const micros = toMicros(text);
  if (micros === null) return text;
  // Round half away from zero to cents.
  const cent = 10_000n;
  const negative = micros < 0n;
  const abs = negative ? -micros : micros;
  const cents = (abs + cent / 2n) / cent;
  const out = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
  return negative && cents !== 0n ? `-${out}` : out;
}

export function sum(values: readonly (string | null | undefined)[]): bigint {
  let total = 0n;
  for (const v of values) total += toMicros(v) ?? 0n;
  return total;
}

/** Product of two decimals in micro-units (quantity × price), rounded half away from zero. */
export function mulMicros(a: bigint, b: bigint): bigint {
  const product = a * b;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + FACTOR / 2n) / FACTOR;
  return negative ? -rounded : rounded;
}

/** Whether two amounts agree to within `tolerance` (default one tiyin, 0.01). */
export function near(a: bigint, b: bigint, tolerance = 10_000n): boolean {
  const d = a - b;
  return (d < 0n ? -d : d) <= tolerance;
}

// Money and quantity cells as written by people and by exports in Uzbek,
// Russian and English locales. Pure.

export type AmountRead = { value: number | null; ambiguous: boolean };

/**
 * "1 234 567,50", "1.234.567,50" or "1,234,567.50" → 1234567.5.
 * With both separators the last one is the decimal point. A single separator
 * followed by exactly three digits after a 1–3 digit whole part ("12,500",
 * "1.250") is read as thousands, and flagged ambiguous: it could also be
 * 12.5. Anything that is not a number reads as null.
 */
export function readAmount(raw: string | null): AmountRead {
  if (raw === null) return { value: null, ambiguous: false };
  // \s also covers the no-break space Excel uses to group thousands.
  const compact = raw.replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(compact)) return { value: null, ambiguous: false };
  const commas = (compact.match(/,/g) ?? []).length;
  const dots = (compact.match(/\./g) ?? []).length;
  let normalized: string;
  let ambiguous = false;
  if (commas > 0 && dots > 0) {
    const lastSep = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'));
    normalized = `${compact.slice(0, lastSep).replace(/[.,]/g, '')}.${compact.slice(lastSep + 1)}`;
  } else if (commas + dots > 1) {
    // One kind of separator, several times: thousands grouping ("1,234,567").
    normalized = compact.replace(/[.,]/g, '');
  } else if (commas + dots === 1) {
    const [whole = '', fraction = ''] = compact.split(/[.,]/);
    const digits = whole.replace('-', '');
    if (fraction.length === 3 && /^[1-9]\d{0,2}$/.test(digits)) {
      normalized = `${whole}${fraction}`;
      ambiguous = true;
    } else {
      normalized = `${whole}.${fraction}`;
    }
  } else {
    normalized = compact;
  }
  const n = Number(normalized);
  return normalized !== '' && Number.isFinite(n) ? { value: n, ambiguous } : { value: null, ambiguous: false };
}

export const parseAmount = (raw: string | null): number | null => readAmount(raw).value;

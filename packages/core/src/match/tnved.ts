// TIF TN (TN VED, Uzbekistan's edition of the Harmonized System) codes as a
// matching input. A goods MXIK code is '0' + the HS4 heading + a position
// sequence: digits 2-5 of every live goods code are its heading (442,029 codes
// under 1,178 headings, 2026-10-23, docs/scoring.md appendix C). Digits 6-8 are
// a sequence number, not the HS subheading, so only the heading can narrow
// retrieval. Service codes (first digit 1) have no heading. Pure.

/** HS codes have even lengths (2, 4, 6, 8, 10); Excel drops a leading zero of chapters 01-09. */
const MIN_DIGITS = 4;
const MAX_DIGITS = 10;

export type TnvedRead =
  | { status: 'empty' }
  /** Digits, but not 4-10 of them (after restoring a lost zero) or no such chapter: ignored. */
  | { status: 'bad'; digits: string }
  /** `restoredZero`: the cell had an odd length, so the leading zero Excel drops was put back. */
  | { status: 'ok'; code: string; heading: string; restoredZero: boolean };

/**
 * Reads a TN VED cell. Separators ("7306.30.190.0", "7306 30 190 0") are
 * ignored; an odd number of digits means a lost leading zero ("702000000" is
 * 0702000000), since no HS code has an odd length. A cell without digits is empty.
 */
export function readTnved(raw: string | null | undefined): TnvedRead {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 0) return { status: 'empty' };
  const restoredZero = digits.length % 2 === 1;
  const code = restoredZero ? `0${digits}` : digits;
  const chapter = Number(code.slice(0, 2));
  if (code.length < MIN_DIGITS || code.length > MAX_DIGITS || chapter < 1 || chapter > 97) return { status: 'bad', digits };
  return { status: 'ok', code, heading: code.slice(0, 4), restoredZero };
}

/** The normalized TN VED code of a cell, or null when it is empty or unreadable. */
export function tnvedCode(raw: string | null | undefined): string | null {
  const read = readTnved(raw);
  return read.status === 'ok' ? read.code : null;
}

/** The HS4 heading of a TN VED cell, or null. */
export function tnvedHeading(raw: string | null | undefined): string | null {
  const read = readTnved(raw);
  return read.status === 'ok' ? read.heading : null;
}

/** The MXIK code prefix of a heading: "7306" -> "07306". */
export function headingPrefix(heading: string): string {
  return `0${heading}`;
}

/** The heading of an MXIK code (digits 2-5), or null for a service code or anything not 17 digits. */
export function mxikHeading(code: string | null | undefined): string | null {
  return code && /^0\d{16}$/.test(code) ? code.slice(1, 5) : null;
}

/** True when `code` is a goods code outside `heading`; a service code or junk is never "outside". */
export function outsideHeading(code: string | null | undefined, heading: string): boolean {
  const own = mxikHeading(code);
  return own !== null && own !== heading;
}

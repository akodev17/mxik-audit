// What kind of values a column of an uploaded file holds, judged from its first rows. Pure: the
// file check shows it under each header so a code column read as numbers (lost zeros) stands out.

export type ColumnKind = 'text' | 'number' | 'code' | 'empty';

/** A 16 or 17 digit run: an MXIK code (16 when Excel dropped the leading zero). */
const CODE = /^\d{16,17}$/;
/** Digits with optional spaces as thousand separators, a sign and one decimal part. */
const NUMBER = /^[-+]?\d{1,3}(?:[\s\u00a0\u202f]?\d{3})*(?:[.,]\d+)?$|^[-+]?\d+(?:[.,]\d+)?$/;

/** One kind per header: a column is a code or a number only when every non-empty sample value is. */
export function columnKinds(headerCount: number, rows: readonly (readonly string[])[]): ColumnKind[] {
  return Array.from({ length: headerCount }, (_, c) => {
    const values = rows.map((r) => (r[c] ?? '').trim()).filter((v) => v.length > 0);
    if (values.length === 0) return 'empty';
    if (values.every((v) => CODE.test(v))) return 'code';
    if (values.every((v) => NUMBER.test(v))) return 'number';
    return 'text';
  });
}

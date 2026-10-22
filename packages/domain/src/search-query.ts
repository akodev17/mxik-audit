// The pure part of search: what a query string means. No database import, so a
// client component (the command palette) can use it without pulling db.ts into
// the browser bundle. search.ts re-exports these for server callers.

export const MIN_TEXT = 2;
export const MIN_CODE_DIGITS = 5;
export const MAX_QUERY = 100;

export type ParsedQuery = { text: string; digits: string | null; tooShort: boolean };

/** Trimmed text, plus the digits when the query reads as a code prefix (spaces and dots allowed). */
export function parseQuery(raw: string): ParsedQuery {
  const text = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  const compact = text.replace(/[\s.-]/g, '');
  const digits = new RegExp(`^\\d{${MIN_CODE_DIGITS},17}$`).test(compact) ? compact : null;
  return { text, digits, tooShort: text.length < MIN_TEXT };
}

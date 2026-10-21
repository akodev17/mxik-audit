// The text sent to lexical retrieval. Pure.

/** Words shorter than this are fragments ("b", "sh" from "б/ш") unless nothing longer is left. */
export const MIN_QUERY_WORD = 3;

const isNumber = (word: string): boolean => /^\d+$/.test(word);
const isFragment = (word: string): boolean => word.length < MIN_QUERY_WORD && !isNumber(word);
const isWord = (word: string): boolean => (word.match(/\p{L}/gu) ?? []).length >= MIN_QUERY_WORD;

/**
 * Drops one- and two-letter fragments when the query has a real word. Full-text
 * ORs every term, so "truba gd b sh" let a cement brand "SEM II/B-Sh" cover two
 * of four terms while steel pipes covered one. A name made only of short words
 * ("un", "ot") is searched as written.
 */
export function lexicalQuery(query: string): string {
  const words = query.split(/\s+/).filter(Boolean);
  return words.some(isWord) ? words.filter((w) => !isFragment(w)).join(' ') : words.join(' ');
}

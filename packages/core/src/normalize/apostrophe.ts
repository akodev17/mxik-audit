// Uzbek uses two distinct modifier letters that authors substitute freely with
// typewriter quotes. The Gate 0 census found seven variants in the official
// export alone, with the correct U+02BB present in only 74 of 438,925 rows.

/**
 * Every mark observed standing in for a Uzbek modifier letter, spelled by
 * codepoint so a combining character cannot slip in unnoticed:
 * ' ` ´ ʹ ʻ ʼ ʽ ‘ ’ ‛ ′
 * U+0301 COMBINING ACUTE is deliberately absent — it is an accent, and including
 * it here would strip accents off decomposed letters such as "é".
 */
const APOSTROPHE_CLASS = /['`´ʹʻʼʽ‘’‛′]/g;

/** U+02BB MODIFIER LETTER TURNED COMMA — correct in oʻ and gʻ. */
export const TURNED_COMMA = 'ʻ';
/** U+02BC MODIFIER LETTER APOSTROPHE — correct for the tutuq belgisi (maʼno). */
export const MODIFIER_APOSTROPHE = 'ʼ';

/**
 * Rewrites any apostrophe-like mark to the orthographically correct letter:
 * U+02BB after o/g, U+02BC everywhere else. Use for display and for canonical
 * storage — not for matching, where the mark should be dropped entirely.
 */
export function normalizeApostrophes(input: string): string {
  return input.replace(APOSTROPHE_CLASS, (_m, offset: number) => {
    const prev = input[offset - 1];
    if (prev === undefined) return MODIFIER_APOSTROPHE;
    return 'oOgG'.includes(prev) ? TURNED_COMMA : MODIFIER_APOSTROPHE;
  });
}

/** Removes apostrophe-like marks outright, so oʻ / o' / o all collapse to o. */
export function stripApostrophes(input: string): string {
  return input.replace(APOSTROPHE_CLASS, '');
}

/** True when the string carries any apostrophe-like mark. */
export function hasApostrophe(input: string): boolean {
  APOSTROPHE_CLASS.lastIndex = 0;
  return APOSTROPHE_CLASS.test(input);
}

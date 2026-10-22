// Script-agnostic text cleanup. Everything here is idempotent and pure.

/** Punctuation that separates tokens rather than belonging to them. */
const SEPARATORS = /[.,;:!?()[\]{}"«»<>/\\|+=*&#@~^%$—–-]+/g;
const WHITESPACE = /\s+/g;

/** Case folding that also handles the Turkish-style dotted I safely for Uzbek. */
export function foldCase(input: string): string {
  return input.toLocaleLowerCase('en-US');
}

/** Collapses runs of 3+ identical letters to one; leaves legitimate doubles alone. */
export function collapseRepeats(input: string): string {
  return input.replace(/(\p{L})\1{2,}/gu, '$1');
}

/** Replaces punctuation with spaces, then squeezes whitespace. */
export function stripPunctuation(input: string): string {
  return input.replace(SEPARATORS, ' ');
}

export function squeezeWhitespace(input: string): string {
  return input.replace(WHITESPACE, ' ').trim();
}

/** Splits into comparable tokens, dropping empties. */
export function tokenize(input: string): string[] {
  return squeezeWhitespace(stripPunctuation(input)).split(' ').filter(Boolean);
}

/** Latin lookalikes for Cyrillic glyphs, which the official export mixes freely
 *  ("dona (pэt butilka)" puts a Cyrillic э inside a Latin word). */
const HOMOGLYPHS: Record<string, string> = {
  э: 'e', е: 'e', а: 'a', о: 'o', с: 'c', р: 'p', х: 'x', у: 'y',
  к: 'k', м: 'm', т: 't', в: 'b', н: 'h', и: 'i', ѕ: 's', і: 'i',
};

/**
 * Repairs single Cyrillic characters stranded inside otherwise-Latin words.
 * Only fires when the surrounding word is predominantly Latin, so genuine
 * Cyrillic text is left alone.
 */
export function repairHomoglyphs(input: string): string {
  return input.replace(/[\p{L}]+/gu, (word) => {
    const latin = (word.match(/[A-Za-z]/g) ?? []).length;
    const cyrillic = (word.match(/[Ѐ-ӿ]/g) ?? []).length;
    if (latin === 0 || cyrillic === 0 || cyrillic > latin) return word;
    return word.replace(/[Ѐ-ӿ]/g, (ch) => {
      const lower = ch.toLowerCase();
      const swap = HOMOGLYPHS[lower];
      if (swap === undefined) return ch;
      return ch === lower ? swap : swap.toUpperCase();
    });
  });
}

/** Single codepoints with no canonical decomposition, so NFD cannot reach them. */
const ATOMIC_DIACRITICS: Record<string, string> = {
  ı: 'i', ł: 'l', ø: 'o', đ: 'd', ħ: 'h', ŋ: 'n', œ: 'oe', æ: 'ae', ß: 'ss', þ: 'th', ð: 'd',
};

/**
 * Folds Latin diacritics to ASCII. Brand names in the catalogue keep their
 * source spelling (Turkish ş/ı/ğ, German ü, French ç), so retrieval has to see
 * past them. Cyrillic must already be transliterated when this runs: ў and й
 * decompose under NFD and would otherwise lose their breves.
 */
export function foldDiacritics(input: string): string {
  const mapped = input.replace(/[ıłøđħŋœæßþð]/gi, (ch) => {
    const lower = ch.toLowerCase();
    const swap = ATOMIC_DIACRITICS[lower];
    if (swap === undefined) return ch;
    return ch === lower ? swap : swap.toUpperCase();
  });
  return mapped.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

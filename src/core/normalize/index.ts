// Composes the normalization steps into the one shape the matcher consumes.
// Pure and deterministic: no I/O, so it is fully unit-testable.
import { normalizeApostrophes, stripApostrophes } from './apostrophe.js';
import { stripNoise, type ExtractedAttrs } from './noise.js';
import { detectScript, latinToCyrillic, scriptAlternates, toLatin, type ScriptKind } from './script.js';
import { collapseRepeats, foldCase, foldDiacritics, repairHomoglyphs, squeezeWhitespace, stripPunctuation, tokenize } from './text.js';

export * from './apostrophe.js';
export * from './noise.js';
export * from './script.js';
export * from './text.js';
export * from './units.js';

export type NormalizedName = {
  /** Exactly what came in. */
  raw: string;
  /** Human-facing form: correct modifier letters, tidy whitespace. */
  display: string;
  /** Product name with packaging noise removed. */
  core: string;
  /** `core` rendered in Latin, whatever the input script. */
  latin: string;
  /** `core` rendered in Cyrillic, to reach Cyrillic-indexed text. */
  cyrillic: string;
  /** Aggressive fold for exact-equality matching. Order preserved. */
  matchKey: string;
  /** Same fold with tokens sorted, so word order stops mattering. */
  sortedKey: string;
  /**
   * `matchKey` minus bare numeric tokens, for fuzzy retrieval. A leftover digit
   * wrecks trigram search: "palov 1 porsiya" matched the chemical "1-Naftol"
   * because word_similarity locked onto the "1".
   */
  queryKey: string;
  tokens: string[];
  attrs: ExtractedAttrs;
  /** Noise substrings that were removed, for explaining a match. */
  removed: string[];
  script: ScriptKind;
};

/**
 * The matching fold. Collapses everything the Gate 0 census proved to be free
 * variation in real data: script, all seven apostrophe marks (so oʻ/o'/o all
 * become o), stranded Cyrillic homoglyphs, case, punctuation and stutters.
 */
export function matchKeyOf(input: string): string {
  const latin = toLatin(repairHomoglyphs(input));
  const folded = collapseRepeats(foldCase(foldDiacritics(stripApostrophes(latin))));
  return squeezeWhitespace(stripPunctuation(folded));
}

export function normalizeName(input: string): NormalizedName {
  const raw = input;
  const display = squeezeWhitespace(normalizeApostrophes(input));
  const { core, attrs, removed } = stripNoise(display);
  const script = detectScript(core);
  const latin = toLatin(repairHomoglyphs(core));
  const cyrillic = script === 'cyrillic' ? core : latinToCyrillic(latin);
  const matchKey = matchKeyOf(core);
  const tokens = tokenize(matchKey);
  const sortedKey = [...tokens].sort().join(' ');
  const wordTokens = tokens.filter((t) => !/^\d+$/.test(t));
  // Fall back to the full key rather than searching for nothing.
  const queryKey = wordTokens.length > 0 ? wordTokens.join(' ') : matchKey;
  return { raw, display, core, latin, cyrillic, matchKey, sortedKey, queryKey, tokens, attrs, removed, script };
}

/**
 * Every key a catalogue name should be indexed under, de-duplicated. Includes
 * the ц alternates, because the catalogue spells the same sound both ways
 * ("sement" vs "tsentner") and either may be what the user typed.
 */
export function indexKeys(input: string): string[] {
  const n = normalizeName(input);
  const keys = new Set<string>();
  for (const base of [n.matchKey, n.sortedKey, matchKeyOf(n.cyrillic)]) {
    for (const alt of scriptAlternates(base)) keys.add(alt);
  }
  keys.delete('');
  return [...keys];
}

/** Normalizes a GTIN to 14 digits, or null when the input cannot be one. */
export function normalizeBarcode(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, '');
  // Gate 0 found 39 catalogue barcodes at 10-11 digits: not valid GTIN lengths.
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  return digits.padStart(14, '0');
}

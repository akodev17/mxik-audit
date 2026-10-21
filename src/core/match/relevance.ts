// Sanity guard: a weak candidate that shares no meaningful word with the
// product is noise (e.g. flour matched to hydrogen), so it is not suggested.
import { matchKeyOf, normalizeName } from '../normalize/index.js';
import { MIN_QUERY_WORD } from './query.js';
import type { MxikCandidate } from './types.js';

/** Below this, an unrelated candidate is dropped; above it retrieval or the reranker vouched for it. */
export const UNRELATED_BELOW = 0.75;

/**
 * A word counts as meaning only when retrieval would search for it: three
 * letters or more, not a bare number (query.ts). Two-letter fragments ("sh"
 * from "б/ш", "pn", "gd") used to make a cement brand "related" to a pipe.
 */
const meaningful = (t: string): boolean => t.length >= MIN_QUERY_WORD && !/^\d+$/.test(t);

function words(text: string): string[] {
  return matchKeyOf(text).split(' ').filter(meaningful);
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4);
}

/**
 * True when some product word appears (up to a suffix) in the candidate's names
 * or groups. Product words are the normalised tokens, so an abbreviation counts
 * through its expansion: "б/ш" shares meaning with a code that says "бесшовные".
 */
export function sharesMeaning(productName: string, candidate: MxikCandidate): boolean {
  const product = normalizeName(productName).tokens.filter(meaningful);
  if (product.length === 0) return true;
  const haystack = [
    candidate.nameUz, candidate.nameRu, candidate.groupName, candidate.className,
    candidate.positionName, candidate.subPositionName, candidate.brandName, candidate.attributeName,
  ].filter((s): s is string => Boolean(s)).flatMap(words);
  return product.some((p) => haystack.some((h) => sameWord(p, h)));
}

/** A candidate to hide: low confidence and no shared word with the product. */
export function isUnrelated(productName: string, candidate: MxikCandidate, confidence: number): boolean {
  return confidence < UNRELATED_BELOW && !sharesMeaning(productName, candidate);
}

// When a product name earns an identifying code (plan T2): the brand or the
// size, dosage, volume, pack or model it names is the one an identifying code
// carries. Pure. The token rules are written down in docs/scoring.md
// ("Identifying codes"); keep the two in step.
import { matchKeyOf, measuresIn, normalizeName, tokenize, type Measure } from '../normalize/index.js';
import type { MxikCandidate } from './types.js';

/** What a row name says that could pick one identifying code. Built once per row. */
export type RowIdentity = {
  /** Folded words as written and as expanded ("эл/св" -> "elektrosvarniye"), each through brandFold. */
  words: ReadonlySet<string>;
  measures: readonly Measure[];
  /** "15х2,5" as written, and its segments: each segment lists its slash alternatives ("3,0/3,5"). */
  size: { text: string; segments: readonly (readonly number[])[] } | null;
  /** "N12", "№12": the count in a pack. */
  pack: { text: string; count: number } | null;
  /** Letters glued to digits that are not a measure, a pack or a size ("15itl6", "m400"). */
  models: readonly string[];
};

export type IdentifyingMatch = {
  /** The brand named by the row, as the code writes it; null when the brand does not match. */
  brand: string | null;
  /** Row fragments the code's attributes repeat: size, measures, pack, model. */
  attributes: string[];
  /** The row names a volume, weight or pack the code also states, with a different value. */
  conflict: boolean;
  /** The code names a brand of its own (brandWords). */
  ownBrand: boolean;
  /** Row words of three letters or more, besides the brand, that the code's names also carry. */
  sharedWords: string[];
  /** How many such row words there are. */
  contentWords: number;
};

const num = (raw: string): number => Number(raw.replace(',', '.'));
const same = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Spelling fold for brand comparison only: the classifier writes "COCA-COLA",
 * a seller writes "Кока-Кола" (folded "koka kola"). Hard c becomes k, soft c
 * becomes s, q k, w v, x ks, ph f, y i, and doubled letters collapse.
 */
export function brandFold(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/ck/g, 'k').replace(/ph/g, 'f').replace(/q/g, 'k').replace(/w/g, 'v').replace(/x/g, 'ks')
    .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/y/g, 'i')
    .replace(/(\p{L})\1+/gu, '$1');
}

/** Brand fields that name no brand: the portal's placeholders. */
const NO_BRAND = new Set(['nobrand', 'no', 'brand', 'brend', 'bez', 'brenda', 'brendsiz', 'yoq', 'net', 'none'].map(brandFold));

const RE_PACK = /(?<![\p{L}\d])(?:n|№|no)\s*\.?\s*(\d+)(?![\p{L}\d])/iu;
const hasDigit = (s: string): boolean => /\d/.test(s);
const letters = (s: string): number => (s.match(/\p{L}/gu) ?? []).length;

function packOf(text: string): { text: string; count: number } | null {
  const m = RE_PACK.exec(text);
  return m?.[1] ? { text: m[0].trim(), count: Number(m[1]) } : null;
}

function sizeOf(dimensions: string | null): RowIdentity['size'] {
  if (!dimensions) return null;
  const segments = dimensions.split(/[xх×*]/i).map((s) => s.split('/').filter(Boolean).map(num).filter(Number.isFinite));
  return segments.length >= 2 && segments.every((s) => s.length > 0) ? { text: dimensions, segments } : null;
}

/**
 * Folded tokens of two letters or more glued to digits ("15itl6", "500mg"). A
 * single letter makes a grade or a pack ("m400", "n12"), a class many codes
 * share, or the size fragment "15x2" that "15х2,5" folds to.
 */
function gluedIn(text: string): string[] {
  return tokenize(matchKeyOf(text)).filter((t) => letters(t) >= 2 && hasDigit(t));
}

/** Glued tokens that are neither a measure ("500mg") nor a pack: a model. */
function modelsIn(text: string): string[] {
  return gluedIn(text).filter((t) => measuresIn(t).length === 0 && packOf(t) === null);
}

export function rowIdentity(rawName: string): RowIdentity {
  const normalized = normalizeName(rawName);
  return {
    words: new Set([...tokenize(matchKeyOf(rawName)), ...normalized.tokens].map(brandFold).filter(Boolean)),
    measures: measuresIn(normalized.display),
    size: sizeOf(normalized.attrs.dimensions),
    pack: packOf(normalized.display),
    models: modelsIn(normalized.display),
  };
}

/**
 * The full-text query that can reach an identifying code: the lexical query's
 * words plus what normalization strips for retrieval, the row's numbers
 * ("15", "2", "5" of "15х2,5"; "500" and "12" of "500mg N12") and the tokens
 * glued to them ("mg", "15itl6"), and each word with k written c, the Latin
 * brand spelling of a Cyrillic name ("Кока-Кола" folds to "koka", the code
 * says "coca"). Null when it would add nothing to the lexical query. Full-text
 * selects on the rare terms only (store.ts fullTextCommonDocs), so the numbers
 * rank codes and never select them.
 */
export function identifyingQuery(lexicalText: string, rawName: string): string | null {
  const words = lexicalText.split(/\s+/).filter(Boolean);
  const spelled = words.filter((w) => w.includes('k')).map((w) => w.replace(/k/g, 'c'));
  const glued = gluedIn(rawName);
  const parts = tokenize(matchKeyOf(rawName)).flatMap((t) => t.split(/(?<=\d)(?=\p{L})|(?<=\p{L})(?=\d)/u));
  const numbers = parts.filter((p) => /^\d+$/.test(p));
  const units = glued.flatMap((t) => t.split(/\d+/)).filter((p) => letters(p) >= 2);
  const extra = [...spelled, ...numbers, ...glued, ...units].filter((t) => !words.includes(t));
  return extra.length === 0 ? null : [...new Set([...words, ...extra])].join(' ');
}

/** The part of a code name after "Position:", where the brand and attributes sit. */
const afterColon = (name: string): string => {
  const i = name.indexOf(':');
  return i < 0 ? '' : name.slice(i + 1);
};

/** The brand before its parenthesised maker: "ПАНАДОЛ (GlaxoSmithKline ... (UK))" is "ПАНАДОЛ". */
const primaryBrand = (brandName: string | null): string => (brandName ?? '').split('(')[0]?.trim() || (brandName ?? '').trim();

export type IdentifyingCandidate = Pick<MxikCandidate,
  'isBase' | 'nameUz' | 'nameRu' | 'brandName' | 'attributeName' | 'groupName' | 'className' | 'positionName' | 'subPositionName'>;

/**
 * The code's own brand words: the brand field without its parenthesised
 * maker ("ПАНАДОЛ (GlaxoSmithKline ...)"), folded, keeping words of two letters
 * or more ("LG"), so the "1", "2", "3" the portal fills in for unbranded metal
 * name no brand, nor do placeholders or words of the code's own hierarchy (a
 * brand "SEMENT" under cement names no maker).
 */
export function brandWords(candidate: IdentifyingCandidate): string[] {
  const hierarchy = new Set(tokenize(matchKeyOf([candidate.groupName, candidate.className, candidate.positionName, candidate.subPositionName]
    .filter(Boolean).join(' '))).map(brandFold));
  return tokenize(matchKeyOf(primaryBrand(candidate.brandName))).map(brandFold)
    .filter((w) => letters(w) >= 2 && !NO_BRAND.has(w) && !hierarchy.has(w));
}

/** Which of the row's identifying tokens this code repeats. Base codes match nothing. */
export function identifyingMatch(row: RowIdentity, candidate: IdentifyingCandidate): IdentifyingMatch {
  if (candidate.isBase) return { brand: null, attributes: [], conflict: false, ownBrand: false, sharedWords: [], contentWords: 0 };
  const brand = brandWords(candidate);
  const brandMatched = brand.length > 0 && brand.every((w) => row.words.has(w));
  const ownWords = new Set(tokenize(matchKeyOf(`${candidate.nameUz} ${candidate.nameRu}`)).map(brandFold));
  const content = [...row.words].filter((w) => letters(w) >= 3 && !brand.includes(w));
  const sharedWords = content.filter((w) => ownWords.has(w));

  const text = [candidate.attributeName ?? '', afterColon(candidate.nameRu), afterColon(candidate.nameUz)].join(' | ');
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map(num);
  const theirs = measuresIn(text);
  const attributes: string[] = [];
  let conflict = false;

  if (row.size && row.size.segments.every((alts) => alts.some((a) => numbers.some((n) => same(a, n))))) attributes.push(row.size.text);
  for (const m of row.measures) {
    const sameKind = theirs.filter((t) => t.kind === m.kind);
    if (sameKind.some((t) => same(t.value, m.value))) attributes.push(m.text);
    // Lengths never contradict: a code states a diameter, a wall and a length in millimetres alike.
    else if (sameKind.length > 0 && m.kind !== 'length') conflict = true;
  }
  if (row.pack) {
    const theirPack = packOf(text);
    if (theirPack?.count === row.pack.count) attributes.push(row.pack.text);
    else if (theirPack) conflict = true;
  }
  const theirModels = new Set(modelsIn(text));
  for (const model of row.models) if (theirModels.has(model)) attributes.push(model);

  return {
    brand: brandMatched ? primaryBrand(candidate.brandName) : null,
    attributes, conflict, ownBrand: brand.length > 0, sharedWords, contentWords: content.length,
  };
}

/**
 * True when the row earns this identifying code: the row names the code's
 * brand and the code is the same product (it repeats an attribute or another
 * word of the row: "Santa Bremor" cosmetics never earn Santa Bremor caviar),
 * or the code has no brand of its own, repeats at least one of the row's
 * sizes, measures, pack counts or models and is named like the row (two of its
 * words, or its one word: a 12 mm sheet is no "Арматура 12 мм", a seamless
 * tube no "Трубы эл/св 57х3,5"); and nothing the row states contradicts the
 * code. A code of another brand never earns it on size alone: "1,5 л" is
 * every brand's bottle.
 */
export function earnsIdentifying(match: IdentifyingMatch): boolean {
  if (match.conflict) return false;
  if (match.brand !== null) return match.attributes.length > 0 || match.sharedWords.length > 0;
  return match.attributes.length > 0 && !match.ownBrand && match.sharedWords.length >= Math.min(2, match.contentWords);
}

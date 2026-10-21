// What full-text search indexes for one classifier code, by weight. Pure.
// load:db and the backfill script both build "searchVectorWeighted" from this,
// so a reloaded classifier and a backfilled one carry the same vector.
//
//   A  the code's own names (exactly the trigram "searchText")
//   B  subposition and position names
//   C  class and group names
//   D  brand and attribute names
//
// Hierarchy names come in all three languages, folded to Latin like every
// other key. A word is indexed once, at the most specific level that has it, so
// a word shared by the leaf name and its position counts as a leaf word.
import { matchKeyOf, tokenize } from '../normalize/index.js';

export type CodeNames = {
  nameUz: string | null; nameRu: string | null;
  subPositionNameUz: string | null; subPositionNameRu: string | null; subPositionNameUzCyrl: string | null;
  positionNameUz: string | null; positionNameRu: string | null; positionNameUzCyrl: string | null;
  classNameUz: string | null; classNameRu: string | null; classNameUzCyrl: string | null;
  groupNameUz: string | null; groupNameRu: string | null; groupNameUzCyrl: string | null;
  brandNameUz: string | null; brandNameRu: string | null; brandNameUzCyrl: string | null;
  attributeNameUz: string | null; attributeNameRu: string | null; attributeNameUzCyrl: string | null;
};

export type WeightedText = { a: string; b: string; c: string; d: string };

/**
 * The trigram text: the two leaf names, folded. Only these two: more text
 * diluted word_similarity (see git history), so the hierarchy goes to full-text only.
 */
export function leafSearchText(nameUz: string | null, nameRu: string | null): string {
  return [matchKeyOf(nameUz ?? ''), matchKeyOf(nameRu ?? '')].filter(Boolean).join(' ');
}

export function weightedSearchText(r: CodeNames): WeightedText {
  const a = leafSearchText(r.nameUz, r.nameRu);
  const seen = new Set(tokenize(a));
  const level = (names: readonly (string | null)[]): string => {
    const words: string[] = [];
    for (const name of names) {
      if (!name) continue;
      for (const word of tokenize(matchKeyOf(name))) {
        if (seen.has(word)) continue;
        seen.add(word);
        words.push(word);
      }
    }
    return words.join(' ');
  };
  return {
    a,
    b: level([r.subPositionNameUz, r.subPositionNameRu, r.subPositionNameUzCyrl, r.positionNameUz, r.positionNameRu, r.positionNameUzCyrl]),
    c: level([r.classNameUz, r.classNameRu, r.classNameUzCyrl, r.groupNameUz, r.groupNameRu, r.groupNameUzCyrl]),
    d: level([r.brandNameUz, r.brandNameRu, r.brandNameUzCyrl, r.attributeNameUz, r.attributeNameRu, r.attributeNameUzCyrl]),
  };
}

/**
 * SQL building the weighted tsvector from four text parameters or columns, in
 * the order a, b, c, d. 'simple' like the unweighted column: no stemming.
 */
export function weightedVectorSql(a: string, b: string, c: string, d: string): string {
  return `setweight(to_tsvector('simple', coalesce(${a}, '')), 'A')`
    + ` || setweight(to_tsvector('simple', coalesce(${b}, '')), 'B')`
    + ` || setweight(to_tsvector('simple', coalesce(${c}, '')), 'C')`
    + ` || setweight(to_tsvector('simple', coalesce(${d}, '')), 'D')`;
}

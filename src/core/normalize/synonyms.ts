// Customer words that are not the classifier's words. Different from
// abbreviations.ts: those expand a short form of the same word ("г/к" →
// "горячекатаный") and become part of the normalised name; these map a seller's
// word onto the different term the classifier uses ("арматура" → "прокат
// арматурный", "минвата" → "минеральная вата") and touch only the text sent to
// lexical retrieval. Match keys, display names, dictionary and group keys never
// change because of a synonym.
// Pure and data-driven: adding a synonym is adding a row, with a test.
import { matchKeyOf } from './index.js';

export type Synonym = {
  /** Words as sellers write them, any script; matched as whole folded tokens. */
  forms: readonly string[];
  /** The classifier's own wording, added to the lexical query. */
  term: string;
  /**
   * Drop the seller's word instead of keeping it beside the term: for words
   * that pull the wrong codes on their own ("арматура" alone retrieves pipe
   * fittings, which the classifier also calls armatura).
   */
  replace?: true;
  /**
   * Stems that signal the word's other meaning: when any query word starts
   * with one, the entry does not apply ("арматура" next to "труба" or "кран"
   * is pipe fittings, not rebar).
   */
  unless?: readonly string[];
};

/**
 * Counts in the comments are live classifier names (nameRu, 2026-08-20 local
 * snapshot, 438,925 codes) containing the word, and are why each entry exists.
 */
export const SYNONYMS: readonly Synonym[] = [
  // Rebar. "прокат арматурный" 314 names; "арматур" 9,892 names, 9,270 of them
  // outside the ferrous groups 072/073 (fittings, "plastik ... armatura").
  {
    forms: ['арматура', 'armatura'],
    term: 'прокат арматурный',
    replace: true,
    unless: [
      'труб', 'trub', 'quvur', 'фитинг', 'fiting', 'кран', 'kran', 'вентил', 'ventil', 'запорн', 'zaporn',
      'сантех', 'santex', 'смыв', 'smiv', 'бачк', 'bachk', 'водопровод', 'vodoprovod', 'пластик', 'plastik',
      'пластмасс', 'plastmass', 'полипропилен', 'polipropilen', 'латун', 'latun', 'муфт', 'muft',
    ],
  },
  // Angle steel: the classifier says "Угловые профили" (56 names, base code
  // 07216001002000000) and "Сталь угловая". "уголок" (203 names) and "уголки"
  // (2,564) are mostly PVC, plaster and furniture corners; adding "уголки"
  // pulled "Уголок 90,100,125" to a PVC corner in the eval (run 20).
  // Corners that are not angle steel keep their own word: "Уголок
  // перфорированный" (plaster corner, 07216001007) was pulled to a plastic
  // profile by "профили" in the re-audit of the 423-row file (2026-10-21).
  {
    forms: ['уголок'],
    term: 'угловые профили угловая сталь',
    unless: [
      'перфор', 'perfor', 'пвх', 'pvx', 'pvc', 'пласт', 'plast', 'мебел', 'mebel', 'алюмин', 'alyumin',
      'декор', 'dekor', 'штукатур', 'shtukatur', 'малярн', 'malyar', 'плинтус', 'plintus',
    ],
  },
  // Mineral wool: "минвата" 0 names, "минеральная вата" 3,496.
  { forms: ['минвата', 'minvata'], term: 'минеральная вата', replace: true },
  // Thermal insulation: "утеплитель" 531 names, "теплоизоляц" 4,117.
  { forms: ['утеплитель', 'uteplitel'], term: 'теплоизоляционные' },
  // Blocks: "газоблок" 1 name (its own base code), "газосиликатн" 6;
  // "пеноблок" 0, "пенобетонн" 14; "керамзитоблок" 0, "керамзитн… блок" 17.
  { forms: ['газоблок', 'gazoblok'], term: 'газосиликатные блоки' },
  { forms: ['пеноблок', 'penoblok'], term: 'пенобетонный блок' },
  { forms: ['керамзитоблок', 'keramzitoblok'], term: 'керамзитный блок' },
  // Polypropylene pipe: "ПП" 346 names, "PPR"/"PP" 197, "полипропиленов" 5,869
  // (Uzbek "polipropilen" 6,150). Kept here, not in abbreviations.ts, so the
  // name's match key does not change.
  { forms: ['ПП', 'ППР', 'PPR'], term: 'полипропиленовые' },
];

type Compiled = { forms: Set<string>; term: string[]; replace: boolean; unless: string[]; label: string };

const COMPILED: readonly Compiled[] = SYNONYMS.map((s) => {
  const term = matchKeyOf(s.term).split(' ').filter(Boolean);
  const forms = new Set(s.forms.map(matchKeyOf).filter(Boolean));
  return {
    forms,
    term,
    replace: s.replace === true,
    unless: (s.unless ?? []).map(matchKeyOf).filter(Boolean),
    label: `${s.forms[0] ?? ''} → ${s.term}`,
  };
});

export type SynonymResult = {
  /** The lexical query with classifier terms added (or substituted). */
  text: string;
  /** Entries that fired, as the table writes them ("арматура → прокат арматурный"), for the evidence. */
  applied: string[];
  /** Folded classifier words the entries put into the query. */
  added: string[];
};

/**
 * Applies the table to a folded lexical query (space-separated match-key
 * tokens). Each entry fires at most once; a term already in the query is not
 * repeated.
 */
export function applySynonyms(query: string): SynonymResult {
  const tokens = query.split(/\s+/).filter(Boolean);
  const applied: string[] = [];
  const added: string[] = [];
  const out: string[] = [];
  const fired = new Set<Compiled>();
  for (const token of tokens) {
    const entry = COMPILED.find((e) => e.forms.has(token));
    const blocked = entry !== undefined && tokens.some((t) => t !== token && entry.unless.some((u) => t.startsWith(u)));
    if (!entry || blocked || fired.has(entry)) {
      out.push(token);
      continue;
    }
    fired.add(entry);
    applied.push(entry.label);
    if (!entry.replace) out.push(token);
    for (const word of entry.term) {
      if (tokens.includes(word) || out.includes(word)) continue;
      out.push(word);
      added.push(word);
    }
  }
  return { text: out.join(' '), applied, added };
}

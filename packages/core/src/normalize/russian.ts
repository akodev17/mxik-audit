// Russian generic product names, the way procurement lists write them: the
// head noun in the nominative singular, with adjectives before or after it
// ("Принтер", "Сетевой кабель", "Реле защитное"). The classifier names the same
// goods in the nominative plural ("Принтеры всех видов", "Реле всех видов").
// The helpers here find the noun a name is about (its head), so a code that
// only mentions the row's product in a dependent phrase ("Тонер для принтера")
// or names another product ("Защитное стекло" for "Реле защитное") can be
// told from one that is that product (match/rules.ts headNounMismatch). Pure.
// Uzbek Cyrillic is left alone: a word with ў, қ, ғ or ҳ is not Russian.

const UZBEK_LETTERS = /[ўқғҳ]/;

/** Adjective and participle endings of the nominative and the common oblique cases. */
const ADJECTIVE = /(ый|ий|ой|ая|яя|ое|ее|ые|ие|ых|их|ого|его|ую|юю|ым|им)$/;

/** Words after which no head follows: the rest of the phrase depends on another noun. */
const PREPOSITIONS = new Set([
  'для', 'из', 'в', 'во', 'на', 'с', 'со', 'по', 'от', 'к', 'ко', 'без', 'кроме', 'под', 'при', 'о', 'об', 'до', 'за', 'над', 'через', 'у',
]);

/** Pronouns and filler that look like nouns to the ending test. */
const NOT_HEADS = new Set([
  'всех', 'все', 'весь', 'вся', 'всего', 'том', 'числе', 'шт', 'или', 'видов', 'вида', 'виды', 'форм', 'формы', 'типа', 'типов', 'марки', 'размер',
]);

const fold = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/** True for a Russian adjective or participle ("сетевой", "моющие", "рассасывающиеся"). */
export function isAdjectiveRu(word: string): boolean {
  const w = fold(word).replace(/(ся|сь)$/, '');
  return w.length >= 4 && ADJECTIVE.test(w);
}

/**
 * Number-blind stem for comparing heads: the final vowel, then a soft sign or
 * й, come off ("принтеры" and "принтер", "ручки" and "ручка", "разбавители" and
 * "разбавитель", "изделия" and "изделие" agree).
 */
export function headStem(word: string): string {
  const stem = fold(word).replace(/[аяыиеоуюэ]$/, '').replace(/[ьй]$/, '');
  return HEAD_SYNONYMS[stem] ?? stem;
}

/** Heads that name the same thing: a "работа" is sold as a service, "аппаратура" is apparatus. */
const HEAD_SYNONYMS: Readonly<Record<string, string>> = { работ: 'услуг', аппаратур: 'аппарат' };

/** Lower-case Russian words of a phrase in order; anything else (Latin, digits) splits words. */
function wordsOf(phrase: string): string[] {
  return fold(phrase).split(/[^а-я]+/).filter(Boolean);
}

/**
 * The head noun of one phrase: the first word that is neither an adjective nor
 * filler, before any preposition. "Сетевой кабель" -> "кабель", "Реле
 * защитное" -> "реле", "Тонер для принтера" -> "тонер"; null when the phrase
 * starts with a preposition, is not Russian, or holds only adjectives.
 */
export function headNoun(phrase: string): string | null {
  if (UZBEK_LETTERS.test(fold(phrase))) return null;
  for (const word of wordsOf(phrase)) {
    if (PREPOSITIONS.has(word)) return null;
    if (NOT_HEADS.has(word) || word.length < 3 || isAdjectiveRu(word)) continue;
    return word;
  }
  return null;
}

/** A row name's head: the head of its first phrase (before a comma, colon or bracket). */
export function rowHead(name: string): string | null {
  const first = name.split(/[,:;(]/)[0] ?? '';
  return headNoun(first);
}

/**
 * Every noun a classifier name offers as what the code is: the head of each of
 * its listed items, split on commas, colons, brackets, "и" and "или".
 * "Сетевые маршрутизаторы, модемы, роутеры и коммутаторы" -> маршрутизаторы,
 * модемы, роутеры, коммутаторы; "Щит (шкаф) распределительный" -> щит, шкаф;
 * "Тонер для принтера" -> тонер only.
 */
export function headNouns(name: string): Set<string> {
  const heads = new Set<string>();
  for (const item of fold(name).split(/[,:;()]|\sи\s|\sили\s/)) {
    const head = headNoun(item);
    if (head) heads.add(head);
  }
  return heads;
}

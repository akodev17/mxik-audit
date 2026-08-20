// Uzbek Cyrillic <-> Latin transliteration.
//
// The rules here are tuned against the classifier's own parallel names: the
// portal publishes every code in both scripts, giving 438,925 ground-truth pairs
// (see `npm run eval:translit`). Where the official 1995 standard and the
// portal's actual usage disagree, the portal wins — its Latin spelling is what
// the catalogue is indexed on.
import { TURNED_COMMA, normalizeApostrophes } from './apostrophe.js';

const VOWELS_CYR = 'аеёиоуўэюяыАЕЁИОУЎЭЮЯЫ';

// Single Cyrillic letters -> Latin. Uzbek-specific letters carry the turned comma.
const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ч: 'ch', ш: 'sh', щ: 'sh', ъ: 'ʼ', ь: '',
  ы: 'i', э: 'e', ю: 'yu', я: 'ya', ё: 'yo',
  ў: `o${TURNED_COMMA}`, қ: 'q', ғ: `g${TURNED_COMMA}`, ҳ: 'h',
  // ц is ts in the general case ("пастеризация" -> "pasterizatsiya"). A handful
  // of loanword stems take s instead ("цемент" -> "sement"), which the catalogue
  // is inconsistent about, so the s reading is carried as an alternate index key
  // rather than chosen here. See `scriptAlternates`.
  ц: 'ts',
};

/** Letters after which "е" is written "ye": vowels and the two soft/hard signs. */
const YE_TRIGGERS = `${VOWELS_CYR}ьъйЬЪЙ`;

const LAT_TO_CYR_DIGRAPHS: [string, string][] = [
  [`o${TURNED_COMMA}`, 'ў'], [`g${TURNED_COMMA}`, 'ғ'],
  ['ch', 'ч'], ['sh', 'ш'], ['yo', 'ё'], ['yu', 'ю'], ['ya', 'я'], ['ye', 'е'],
  ['ts', 'ц'], ['ng', 'нг'],
];

const LAT_TO_CYR: Record<string, string> = {
  a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', j: 'ж', z: 'з', i: 'и',
  y: 'й', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', r: 'р', s: 'с',
  t: 'т', u: 'у', f: 'ф', x: 'х', h: 'ҳ', q: 'қ', c: 'к', w: 'в',
};

const isUpperLetter = (ch: string | undefined): boolean =>
  ch !== undefined && /\p{L}/u.test(ch) && ch === ch.toUpperCase() && ch !== ch.toLowerCase();

/**
 * Preserves the source casing pattern when a rule expands one char to several.
 * "Ш" alone titles to "Sh", but inside a shouted word ("ШАКАР") it caps to "SH",
 * so the decision needs the neighbouring characters.
 */
function matchCase(source: string, replacement: string, prev?: string, next?: string): string {
  if (!replacement || source === source.toLowerCase()) return replacement;
  const shouting = isUpperLetter(prev) || isUpperLetter(next);
  if (shouting) return replacement.toUpperCase();
  return replacement.charAt(0).toUpperCase() + replacement.slice(1).toLowerCase();
}

/**
 * Cyrillic -> Latin. Handles the word-initial e/ye rule and leaves any
 * non-Cyrillic runs (Latin brand names, digits, punctuation) untouched, which
 * matters because 23% of the catalogue's Latin names embed Cyrillic brands.
 */
export function cyrillicToLatin(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === undefined) continue;
    const lower = ch.toLowerCase();

    const prev = input[i - 1];
    const next = input[i + 1];

    if (lower === 'е') {
      // "е" is ye after a vowel or ь/ъ/й, e otherwise. The standard also says ye
      // word-initially, but the catalogue is dominated by Russian loanwords that
      // the portal spells with a plain e ("Експорт" -> "Eksport"), and matching
      // the catalogue is what counts here.
      const afterTrigger = prev !== undefined && YE_TRIGGERS.includes(prev);
      out += matchCase(ch, afterTrigger ? 'ye' : 'e', prev, next);
      continue;
    }

    const mapped = CYR_TO_LAT[lower];
    if (mapped === undefined) { out += ch; continue; }
    out += matchCase(ch, mapped, prev, next);
  }
  return normalizeApostrophes(out);
}

/**
 * Latin -> Cyrillic. Lossy by nature (x/h and e/э collapse), so it exists to
 * widen retrieval against Cyrillic-indexed text, not to produce correct prose.
 */
export function latinToCyrillic(input: string): string {
  const normalized = normalizeApostrophes(input);
  let out = '';
  let i = 0;
  outer: while (i < normalized.length) {
    const rest = normalized.slice(i);
    for (const [lat, cyr] of LAT_TO_CYR_DIGRAPHS) {
      const head = rest.slice(0, lat.length);
      if (head.toLowerCase() === lat) {
        out += matchCase(head, cyr);
        i += lat.length;
        continue outer;
      }
    }
    const ch = normalized[i];
    if (ch === undefined) break;
    const mapped = LAT_TO_CYR[ch.toLowerCase()];
    out += mapped === undefined ? ch : matchCase(ch, mapped);
    i += 1;
  }
  return out;
}

const CYRILLIC = /[Ѐ-ӿԀ-ԯ]/;
const LATIN = /[A-Za-z]/;

export type ScriptKind = 'cyrillic' | 'latin' | 'mixed' | 'neither';

/** Which script(s) a string is written in. 23% of the catalogue is 'mixed'. */
export function detectScript(input: string): ScriptKind {
  const cyr = CYRILLIC.test(input);
  const lat = LATIN.test(input);
  if (cyr && lat) return 'mixed';
  if (cyr) return 'cyrillic';
  if (lat) return 'latin';
  return 'neither';
}

/**
 * Renders a string into Latin regardless of input script, transliterating any
 * Cyrillic runs in place. Idempotent for pure-Latin input.
 */
export function toLatin(input: string): string {
  return detectScript(input) === 'latin' ? normalizeApostrophes(input) : cyrillicToLatin(input);
}

/**
 * Alternate spellings a name should also be indexed under, because the
 * catalogue itself is inconsistent. Currently the two readings of ц: "sement"
 * and "tsement" must both find the cement row.
 */
export function scriptAlternates(latin: string): string[] {
  const seeds = new Set<string>([latin]);
  // Both readings of ц: "sement" and "tsement" must reach the same row.
  if (/ts/i.test(latin)) seeds.add(latin.replace(/ts/gi, 's'));
  if (/(?<!t)s/i.test(latin)) seeds.add(latin.replace(/(?<!t)s/gi, 'ts'));
  // Both readings of word-initial е, which the catalogue spells inconsistently
  // in each direction ("Eksport" but also "Yer"), so no single rule wins.
  const out = new Set<string>(seeds);
  for (const seed of seeds) {
    out.add(seed.replace(/\bye/gi, 'e'));
    out.add(seed.replace(/\be(?!$)/gi, 'ye'));
  }
  return [...out];
}

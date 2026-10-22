// Trade abbreviations expanded to the words the classifier uses. Metal and
// construction price lists are written almost entirely in them: "Труба ГД б/ш"
// left as is folds to "truba gd b sh", whose fragments matched a cement brand
// ("SEM II/B-Sh") instead of seamless pipe. The classifier spells the words out
// ("бесшовные" in 4,806 Russian names), so the expansion is what retrieval needs.
// Pure and data-driven: adding an abbreviation is adding a row.

export type Abbreviation = {
  /** Written forms, matched as whole tokens, case-insensitively, with or without a trailing dot. */
  forms: readonly string[];
  /** Replacement for Cyrillic text: the Russian term, in the inflection the classifier's names use. */
  ru: string;
  /** Replacement for Latin-script text: the term the classifier's Uzbek names use, when they have one. */
  uz?: string;
  /** The classifier writes the short form too ("ПВХ" in 2,137 names), so it stays beside the expansion. */
  keep?: true;
  /** A unit of sale, not part of the product: removed, not expanded. */
  unit?: true;
};

/**
 * Counts in the comments are live classifier names (nameRu) containing the
 * expanded form, from the 2026-10 local classifier; they are why each
 * inflection was chosen.
 */
export const ABBREVIATIONS: readonly Abbreviation[] = [
  // Pipes and rolled metal.
  { forms: ['б/ш', 'b/sh'], ru: 'бесшовные', uz: 'choksiz' }, // бесшовные 4,361, бесшовная 111
  { forms: ['г/к', 'g/k'], ru: 'горячекатаный', uz: 'issiq prokatlangan' }, // 1,574
  { forms: ['х/к', 'x/k'], ru: 'холоднокатаный', uz: 'sovuq prokatlangan' },
  { forms: ['эл/св', 'el/sv'], ru: 'электросварные', uz: 'elektr payvandlangan' }, // 5,162
  { forms: ['ВГП', 'VGP'], ru: 'водогазопроводная' }, // 189; the classifier also writes ВГП 4 times
  { forms: ['ГД'], ru: 'горячедеформированные', uz: 'issiq deformatsiyalangan' }, // 648
  { forms: ['ХД'], ru: 'холоднодеформированные', uz: 'sovuq deformatsiyalangan' }, // 598
  { forms: ['проф'], ru: 'профильная' },
  { forms: ['арм'], ru: 'арматура' },
  { forms: ['риф'], ru: 'рифленый' },
  { forms: ['н/ж'], ru: 'нержавеющая' },
  { forms: ['оцинк'], ru: 'оцинкованный' },
  { forms: ['г/ц'], ru: 'горячеоцинкованный' }, // 890; "горячего цинкования" appears 5 times
  // Construction materials.
  { forms: ['ж/б'], ru: 'железобетонный', keep: true }, // ж/б 58
  { forms: ['ПВХ', 'PVX', 'PVC'], ru: 'поливинилхлоридные', keep: true }, // ПВХ 2,137; поливинилхлоридные 4,676
  { forms: ['ГКЛ', 'GKL'], ru: 'гипсокартонный лист', keep: true }, // ГКЛ 33
  { forms: ['ДСП', 'DSP'], ru: 'древесностружечная плита', keep: true }, // ДСП 245
  { forms: ['ДВП', 'DVP'], ru: 'древесноволокнистая плита', keep: true }, // ДВП 5
  { forms: ['ОСБ', 'OSB'], ru: 'ориентированно-стружечная плита', keep: true }, // OSB 14
  // Units of sale.
  { forms: ['м/п'], ru: 'погонный метр', unit: true },
];

const CYRILLIC = /[Ѐ-ӿ]/;
// Cyrillic is outside JS \b, so gate on explicit letter/digit lookarounds (see noise.ts).
const LEFT = String.raw`(?<![\p{L}\d])`;
const RIGHT = String.raw`(?![\p{L}\d])`;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const byForm = new Map<string, Abbreviation>();
for (const entry of ABBREVIATIONS) {
  for (const form of entry.forms) byForm.set(form.toLowerCase(), entry);
}
// Longest first, so "эл/св" is tried before anything it contains.
const FORMS = [...byForm.keys()].sort((a, b) => b.length - a.length);
// The dot is taken only when no letter follows it: "проф.труба" keeps its separator.
const RE = new RegExp(`${LEFT}(${FORMS.map(escape).join('|')})(?:\\.(?![\\p{L}\\d]))?${RIGHT}`, 'giu');

export type AbbreviationResult = {
  text: string;
  /** Abbreviations that were expanded, as written. */
  expanded: string[];
  /** Units of sale that were dropped, as written. */
  removed: string[];
};

/**
 * Replaces each known abbreviation with its expansion, in place. Cyrillic forms
 * get the Russian term, Latin forms the Uzbek one (or the Russian when the
 * classifier has no Uzbek wording for it).
 */
export function expandAbbreviations(input: string): AbbreviationResult {
  const expanded: string[] = [];
  const removed: string[] = [];
  const replaced = input.replace(RE, (whole: string, form: string) => {
    const entry = byForm.get(form.toLowerCase());
    if (!entry) return whole;
    if (entry.unit) {
      removed.push(whole);
      return ' ';
    }
    expanded.push(whole);
    const term = CYRILLIC.test(form) ? entry.ru : (entry.uz ?? entry.ru);
    return entry.keep ? `${form} ${term}` : term;
  });
  const text = removed.length > 0 ? replaced.replace(/\s+/g, ' ').trim() : replaced;
  return { text, expanded, removed };
}

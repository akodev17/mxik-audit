// Realistic catalogue noise for synthetic eval cases. Pure and seeded, so the
// synthetic set is reproducible. Each transform mirrors something Gate 0
// measured in real data (docs/gate0-report.md).
import { latinToCyrillic } from '@tasnivo/core/normalize/script';

export type Rng = () => number;

/** Deterministic LCG, same family as prisma/seed.ts. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

/** The seven apostrophe characters found in the official Latin export. */
export const APOSTROPHES = ['ʻ', '’', "'", '`', '‘', '´', 'ʼ'] as const;
const APOSTROPHE_RE = /[ʻ’'`‘´ʼ]/g;
const HAS_APOSTROPHE = /[ʻ’'`‘´ʼ]/;

const PACKS = ['1.5L', '1,5 л', 'x12', '500gr', '500 гр', '12 dona', '(90 шт)', '0.33 L', '1 kg', 'x 6', '250 ml', '2 kg'];
const BRANDS = ['Nestle', 'Bonduelle', 'Coca-Cola', 'Родной дом', 'Мираторг', 'Santa Bremor', 'Promeat', 'BQ', 'Artel', 'Akfa'];

/** Latin letters with a Cyrillic twin that renders identically. */
const HOMOGLYPHS: Record<string, string> = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р', x: 'х', y: 'у', A: 'А', E: 'Е', O: 'О', C: 'С', P: 'Р', X: 'Х' };

export type Transform = 'apostrophe' | 'mixed-script' | 'pack' | 'typo' | 'brand' | 'case';

type Step = (name: string, rng: Rng) => string;

/** Index of a random word at least `min` letters long, or -1. */
function wordAt(words: string[], rng: Rng, min: number): number {
  const eligible = words.map((w, i) => (/\p{L}/u.test(w) && w.length >= min ? i : -1)).filter((i) => i >= 0);
  return eligible.length === 0 ? -1 : pick(rng, eligible);
}

const STEPS: Record<Transform, Step> = {
  apostrophe: (name, rng) => name.replace(APOSTROPHE_RE, () => pick(rng, APOSTROPHES)),
  'mixed-script': (name, rng) => {
    const words = name.split(' ');
    const i = wordAt(words, rng, 4);
    if (i < 0) return name;
    const word = words[i] ?? '';
    // Either the whole word in Cyrillic, or invisible homoglyphs inside it.
    words[i] = rng() < 0.5
      ? latinToCyrillic(word)
      : [...word].map((ch) => (rng() < 0.5 ? HOMOGLYPHS[ch] ?? ch : ch)).join('');
    return words.join(' ');
  },
  pack: (name, rng) => `${name} ${pick(rng, PACKS)}`,
  typo: (name, rng) => {
    const words = name.split(' ');
    const i = wordAt(words, rng, 5);
    if (i < 0) return name;
    const chars = [...(words[i] ?? '')];
    const at = 1 + Math.floor(rng() * (chars.length - 2));
    const kind = Math.floor(rng() * 3);
    if (kind === 0) [chars[at], chars[at + 1]] = [chars[at + 1] ?? '', chars[at] ?? ''];
    else if (kind === 1) chars.splice(at, 1);
    else chars.splice(at, 0, chars[at] ?? '');
    words[i] = chars.join('');
    return words.join(' ');
  },
  brand: (name, rng) => `${pick(rng, BRANDS)} ${name}`,
  case: (name, rng) => (rng() < 0.7 ? name.toUpperCase() : name.toLowerCase()),
};

const ALL: readonly Transform[] = ['apostrophe', 'mixed-script', 'pack', 'typo', 'brand', 'case'];

/** Applies 2-4 distinct transforms; reports only those that changed the name. */
export function noisify(name: string, rng: Rng): { name: string; applied: Transform[] } {
  const count = 2 + Math.floor(rng() * 3);
  const chosen = [...ALL].sort(() => rng() - 0.5).slice(0, count);
  // Always exercise apostrophe drift when the name has one: it is the most
  // common real-world defect (48% of classifier rows carry a mark).
  if (HAS_APOSTROPHE.test(name) && !chosen.includes('apostrophe')) chosen.unshift('apostrophe');

  let current = name;
  const applied: Transform[] = [];
  // Case last, so a later step cannot reintroduce mixed case.
  for (const t of chosen.sort((a, b) => Number(a === 'case') - Number(b === 'case'))) {
    const next = STEPS[t](current, rng);
    if (next !== current) applied.push(t);
    current = next;
  }
  // A clean name would only inflate accuracy; a pack size always changes it.
  if (applied.length === 0) {
    current = STEPS.pack(current, rng);
    applied.push('pack');
  }
  return { name: current.replace(/\s+/g, ' ').trim(), applied };
}

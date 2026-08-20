// Resolves a free-text unit of measure onto the portal's official unit ids.
//
// Two problems this has to absorb. First, catalogues are written by humans in
// four notations (uz Latin, uz Cyrillic, Russian, English abbreviations).
// Second, the portal's own Latin transliteration is inconsistent about ц —
// "Портландцемент" becomes "Portlandsement" but "центнер" becomes "tsentner" —
// so every ц-bearing unit is indexed under both spellings.
import { stripApostrophes } from './apostrophe.js';
import { cyrillicToLatin, detectScript } from './script.js';
import { repairHomoglyphs, squeezeWhitespace } from './text.js';
import { OFFICIAL_UNITS, type OfficialUnit } from './units.generated.js';

export type { OfficialUnit };

/** Abbreviations and colloquial spellings users type that no official list contains. */
const ALIASES: Record<string, string> = {
  // mass
  kg: 'kilogramm', кг: 'kilogramm', kgs: 'kilogramm', кило: 'kilogramm',
  g: 'gramm', г: 'gramm', gr: 'gramm', гр: 'gramm', gm: 'gramm', gram: 'gramm',
  mg: 'milligramm', мг: 'milligramm',
  t: 'tonna', т: 'tonna', tn: 'tonna', тн: 'tonna', ton: 'tonna',
  ц: 'tsentner', centner: 'tsentner', tsent: 'tsentner',
  // volume
  l: 'litr', л: 'litr', lt: 'litr', liter: 'litr', литр: 'litr',
  ml: 'millilitr', мл: 'millilitr',
  dal: 'dekalitr', дал: 'dekalitr',
  // count
  sht: 'dona', шт: 'dona', 'шт.': 'dona', pcs: 'dona', pc: 'dona',
  piece: 'dona', pieces: 'dona', ea: 'dona', adet: 'dona', don: 'dona',
  komplekt: 'toʻplam', комплект: 'toʻplam', set: 'toʻplam', компл: 'toʻplam',
  para: 'juft', пара: 'juft', pair: 'juft',
  // length / area / volume geometry
  m: 'metr', м: 'metr', cm: 'santimetr', см: 'santimetr',
  mm: 'millimetr', мм: 'millimetr', km: 'kilometr', км: 'kilometr',
  m2: 'kv. metr', м2: 'kv. metr', 'kv.m': 'kv. metr', 'кв.м': 'kv. metr', sqm: 'kv. metr',
  m3: 'kub. metr', м3: 'kub. metr', 'kub.m': 'kub. metr', 'куб.м': 'kub. metr',
  ga: 'ga', га: 'ga', sotka: 'yuz kvadrat metr (sotka)', сотка: 'yuz kvadrat metr (sotka)',
  // time
  soat: 'soat', час: 'soat', hour: 'soat', h: 'soat',
  kun: 'kun', день: 'kun', day: 'kun',
  daqiqa: 'daqiqa', минута: 'daqiqa', min: 'daqiqa',
};

/** Both readings of ц, because the portal uses each in different words. */
function tsAlternates(value: string): string[] {
  const out = new Set<string>([value]);
  if (value.includes('ts')) out.add(value.replace(/ts/g, 's'));
  if (value.includes('s')) out.add(value.replace(/s/g, 'ts'));
  return [...out];
}

function baseKey(input: string): string {
  const repaired = repairHomoglyphs(input);
  const latin = detectScript(repaired) === 'latin' ? repaired : cyrillicToLatin(repaired);
  return squeezeWhitespace(stripApostrophes(latin.toLowerCase()))
    .replace(/\s*\.\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INDEX = new Map<string, OfficialUnit>();

function index(key: string, unit: OfficialUnit): void {
  const k = baseKey(key);
  if (k && !INDEX.has(k)) INDEX.set(k, unit);
}

for (const unit of OFFICIAL_UNITS) {
  for (const form of [unit.cyrillic, unit.latin]) {
    for (const variant of tsAlternates(baseKey(form))) index(variant, unit);
    // "дона (бутылка)" should also be reachable as "dona" and as "butilka".
    const withoutParen = form.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (withoutParen && withoutParen !== form) {
      for (const variant of tsAlternates(baseKey(withoutParen))) index(variant, unit);
    }
    const inner = /\(([^)]+)\)/.exec(form)?.[1];
    if (inner) for (const variant of tsAlternates(baseKey(inner))) index(variant, unit);
  }
}
for (const [alias, target] of Object.entries(ALIASES)) {
  const resolved = INDEX.get(baseKey(target));
  if (resolved) for (const variant of tsAlternates(baseKey(alias))) index(variant, resolved);
}

/**
 * Maps free text onto an official unit, or null when nothing matches.
 * Tries progressively looser readings: exact, ц-alternates, quantity-prefixed
 * ("500 gramm"), and parenthesised qualifiers ("dona (butilka) 0.75 litr").
 */
export function resolveUnit(input: string | null | undefined): OfficialUnit | null {
  if (!input) return null;
  const key = baseKey(input);
  if (!key) return null;

  for (const variant of tsAlternates(key)) {
    const hit = INDEX.get(variant);
    if (hit) return hit;
  }
  // "500 gramm" / "0.75 litr" -> drop the quantity.
  const unprefixed = key.replace(/^\d+(?:[.,]\d+)?\s*/, '');
  if (unprefixed !== key) {
    for (const variant of tsAlternates(unprefixed)) {
      const hit = INDEX.get(variant);
      if (hit) return hit;
    }
  }
  // "dona (butilka) 0.75 litr" -> "dona".
  const head = key.split('(')[0]?.trim();
  if (head && head !== key) {
    for (const variant of tsAlternates(head)) {
      const hit = INDEX.get(variant);
      if (hit) return hit;
    }
  }
  const inner = /\(([^)]+)\)/.exec(key)?.[1]?.trim();
  if (inner) {
    for (const variant of tsAlternates(inner)) {
      const hit = INDEX.get(variant);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Whether a catalogue row's unit contradicts a classifier unit. Unresolvable
 * input is never a conflict — UNIT_CONFLICT must not fire on our own ignorance.
 */
export function unitsCompatible(rowUnit: string | null, codeUnits: readonly string[]): boolean {
  if (!rowUnit || codeUnits.length === 0) return true;
  const row = resolveUnit(rowUnit);
  if (!row) return true;
  const resolved = codeUnits.map(resolveUnit).filter((u): u is OfficialUnit => u !== null);
  if (resolved.length === 0) return true;
  return resolved.some((u) => u.id === row.id);
}

/** Diagnostics for the ingest and eval reports. */
export function unitIndexSize(): number {
  return INDEX.size;
}

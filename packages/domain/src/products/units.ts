// A product file's unit of measure as a tasnif unit id (products §7.9, ids from §1.4:
// GET /integration-mxik/references/get/units/all?pageSize=100, live 2026-10-30). The words people
// write in RU, UZ Latin, UZ Cyrillic and English are looked up here first; anything else goes to the
// matcher's resolver (core/normalize/units.ts, the 90 official names). Pure.
import { resolveUnit } from '@tasnivo/core/normalize/index';

export type TasnifUnit = { id: number; name: string };

/** The ids the checks use, with the Uzbek (Cyrillic) name tasnif gives them. */
export const UNIT = {
  piece: { id: 1, name: 'дона' },
  milligram: { id: 3, name: 'миллиграмм' },
  gram: { id: 4, name: 'грамм' },
  kilogram: { id: 5, name: 'килограмм' },
  centner: { id: 6, name: 'центнер' },
  tonne: { id: 7, name: 'тонна' },
  metre: { id: 11, name: 'метр' },
  squareMetre: { id: 16, name: 'кв. метр' },
  cubicMetre: { id: 20, name: 'куб. метр' },
  millilitre: { id: 22, name: 'миллилитр' },
  litre: { id: 23, name: 'литр' },
  decalitre: { id: 24, name: 'декалитр' },
  service: { id: 25, name: 'хизмат (сўм)' },
  set: { id: 26, name: 'тўплам' },
  hour: { id: 28, name: 'соат' },
  day: { id: 42, name: 'кун' },
  month: { id: 43, name: 'ой' },
  year: { id: 57, name: 'йил' },
  thousandPieces: { id: 84, name: 'минг дона' },
  sum: { id: 113, name: 'сўм' },
} as const satisfies Record<string, TasnifUnit>;

/** Spellings seen in product files (§4, §7.9), folded by unitWord(). */
const WORDS: readonly (readonly [TasnifUnit, readonly string[]])[] = [
  [UNIT.piece, ['шт', 'штук', 'штука', 'штуки', 'дона', 'dona', 'pcs', 'pc', 'piece', 'pieces', 'ea', 'шт ед', 'единица']],
  [UNIT.kilogram, ['кг', 'килограмм', 'килограм', 'kg', 'kilogramm', 'kilogram']],
  [UNIT.gram, ['г', 'гр', 'грамм', 'грам', 'g', 'gr', 'gramm', 'gram']],
  [UNIT.milligram, ['мг', 'миллиграмм', 'mg']],
  [UNIT.tonne, ['т', 'тн', 'тонна', 'тонн', 't', 'tn', 'tonna', 'ton']],
  [UNIT.centner, ['ц', 'центнер', 'sentner', 'tsentner']],
  [UNIT.litre, ['л', 'литр', 'литров', 'l', 'lt', 'litr', 'liter', 'litre']],
  [UNIT.millilitre, ['мл', 'миллилитр', 'ml', 'millilitr']],
  [UNIT.decalitre, ['дал', 'декалитр', 'dal']],
  [UNIT.metre, ['м', 'метр', 'пог м', 'п м', 'm', 'metr', 'meter', 'metre']],
  [UNIT.squareMetre, ['м2', 'м²', 'кв м', 'кв метр', 'квадратный метр', 'm2', 'm²', 'kv m', 'kv metr', 'sqm']],
  [UNIT.cubicMetre, ['м3', 'м³', 'куб м', 'куб метр', 'кубический метр', 'm3', 'm³', 'kub m', 'kub metr']],
  [UNIT.service, ['услуга', 'услуги', 'услуга сум', 'хизмат', 'хизмат сўм', 'хизмат сум', 'xizmat', 'xizmat som', 'service']],
  [UNIT.set, ['комплект', 'компл', 'набор', 'тўплам', 'toʻplam', 'toplam', 'set']],
  [UNIT.hour, ['час', 'ч', 'соат', 'soat', 'hour', 'h']],
  [UNIT.day, ['день', 'дн', 'сутки', 'кун', 'kun', 'day']],
  [UNIT.month, ['месяц', 'мес', 'ой', 'oy', 'month']],
  [UNIT.year, ['год', 'йил', 'yil', 'year']],
  [UNIT.thousandPieces, ['тыс шт', 'минг дона', 'ming dona']],
  [UNIT.sum, ['сум', 'сўм', 'soʻm', 'som', 'uzs']],
];

/** Lower case, apostrophes and dots dropped, single spaces. */
export function unitWord(text: string): string {
  return text.toLowerCase().replace(/[ʻʼ'`’‘]/g, '').replace(/[.()]/g, ' ').replace(/\s+/g, ' ').trim();
}

const INDEX = new Map<string, TasnifUnit>(WORDS.flatMap(([unit, words]) => words.map((w) => [unitWord(w), unit] as const)));

/** The tasnif unit a file's unit cell stands for; null when nothing matches (never a guess). */
export function normalizeUnit(text: string | null | undefined): TasnifUnit | null {
  const word = unitWord(text ?? '');
  if (!word) return null;
  const hit = INDEX.get(word);
  if (hit) return hit;
  // "шт. (упаковка)", "услуга (сум)": the word before the qualifier.
  const head = unitWord((text ?? '').split('(')[0] ?? '');
  const headHit = head && head !== word ? INDEX.get(head) : undefined;
  if (headHit) return headHit;
  const official = resolveUnit(text ?? '');
  return official ? { id: official.id, name: official.cyrillic } : null;
}

/** Units a service is counted in: the service unit itself, the sum, and time (hour, day, month, year). */
export const SERVICE_UNIT_IDS: ReadonlySet<number> = new Set([UNIT.service.id, UNIT.sum.id, UNIT.hour.id, UNIT.day.id, UNIT.month.id, UNIT.year.id]);

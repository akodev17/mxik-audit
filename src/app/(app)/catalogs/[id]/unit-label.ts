// Classifier units and packaging in the viewer's language. Pure. The official
// unit table is Uzbek (Latin and Cyrillic); Russian readers get the usual
// Russian abbreviation where there is one, otherwise the Cyrillic form.
import { latinToCyrillic } from '@/core/normalize/script';
import { resolveUnit } from '@/core/normalize/units';
import type { Locale } from '@/lib/i18n';

/** Official Latin unit name -> Russian. */
const RU: Record<string, string> = {
  dona: 'шт', gramm: 'г', kilogramm: 'кг', milligramm: 'мг', tonna: 'т', sentner: 'ц',
  millilitr: 'мл', litr: 'л', dekalitr: 'дал', millimetr: 'мм', santimetr: 'см', desimetr: 'дм', metr: 'м', kilometr: 'км',
  'kv. metr': 'м²', 'kub. metr': 'м³', juft: 'пара', 'toʻplam': 'комплект', soat: 'час', daqiqa: 'мин', kun: 'день', oy: 'месяц', yil: 'год', ga: 'га',
};

/** Containers the classifier names that are not units (unitContainer). */
const CONTAINER_RU: Record<string, string> = {
  banka: 'банка', quti: 'коробка', korobka: 'коробка', paket: 'пакет', paketcha: 'пакетик', shisha: 'бутылка', butilka: 'бутылка',
  flakon: 'флакон', tuba: 'туба', qop: 'мешок', yashik: 'ящик', rulon: 'рулон', ampula: 'ампула',
};

/** Suffixes the packaging reader writes ("250 g", "1,5 L", "12 dona"). */
const SUFFIX_RU: Record<string, string> = { g: 'г', kg: 'кг', ml: 'мл', L: 'л', mm: 'мм', dona: 'шт' };

/** A classifier unit ("dona", "kv. metr", "dona (butilka)") in the viewer's language. */
export function unitLabel(locale: Locale, unit: string): string {
  const official = resolveUnit(unit);
  if (!official) return locale === 'ru' ? containerLabel(locale, unit) : unit;
  if (locale !== 'ru') return official.latin;
  const head = official.latin.split('(')[0]?.trim() ?? official.latin;
  const inner = /\(([^)]+)\)/.exec(official.cyrillic)?.[1];
  const base = RU[official.latin] ?? RU[head] ?? official.cyrillic;
  return inner && RU[head] ? `${base} (${inner})` : base;
}

/** A container name ("banka") in the viewer's language. */
export function containerLabel(locale: Locale, value: string): string {
  if (locale !== 'ru') return value;
  const key = value.trim().toLowerCase();
  return CONTAINER_RU[key] ?? (/^[a-zʻʼ'\s.-]+$/i.test(key) ? latinToCyrillic(value) : value);
}

/** One packaging value ("50 g", "1,5 L") with its unit in the viewer's language. */
export function packagingLabel(locale: Locale, value: string): string {
  if (locale !== 'ru') return value;
  const m = /^([\d.,]+)\s+(\S+)$/.exec(value.trim());
  if (!m) return value;
  const suffix = SUFFIX_RU[m[2] ?? ''];
  return suffix ? `${m[1]} ${suffix}` : value;
}

// Strips packaging noise off a product name and keeps it as structured
// attributes. Gate 0 measured why this matters: the portal's own search returns
// Paracetamol for "Coca-Cola 1.5L" but the correct beverage row for "Coca Cola".
// The attributes are retained because they decide between a base code and an
// identifying code once a subposition has been picked.
import { squeezeWhitespace } from './text.js';

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
// Cyrillic is outside JS \b, so gate on explicit letter/digit lookarounds.
const LEFT = String.raw`(?<![\p{L}\d])`;
const RIGHT = String.raw`(?![\p{L}])`;

/** Longest alternatives first so "litr" wins over "l". */
const VOLUME_UNITS = ['millilitr', 'миллилитр', 'mililitr', 'litr', 'литр', 'liter', 'ml', 'мл', 'cl', 'сл', 'dl', 'дл', 'lt', 'л', 'l'] as const;
const WEIGHT_UNITS = ['kilogramm', 'килограмм', 'milligramm', 'миллиграмм', 'gramm', 'грамм', 'tonna', 'тонна', 'gram', 'kilo', 'kg', 'кг', 'mg', 'мг', 'gr', 'гр', 'gm', 'g', 'г'] as const;
// "porsiya" is a real classifier unit (дона (порция)) and shows up constantly in
// food-service catalogues; without it the orphan digit leaks into the query.
const COUNT_UNITS = ['komplekt', 'комплект', 'toʻplam', 'toplam', 'porsiya', 'порция', 'porciya', 'dona', 'дона', 'штук', 'шт', 'sht', 'pieces', 'piece', 'pcs', 'pc', 'упак', 'пач'] as const;
const LENGTH_UNITS = ['santimetr', 'сантиметр', 'millimetr', 'миллиметр', 'metr', 'метр', 'cm', 'см', 'mm', 'мм', 'm', 'м'] as const;

const TO_ML: Record<string, number> = { millilitr: 1, миллилитр: 1, mililitr: 1, ml: 1, мл: 1, cl: 10, сл: 10, dl: 100, дл: 100, litr: 1000, литр: 1000, liter: 1000, lt: 1000, л: 1000, l: 1000 };
const TO_G: Record<string, number> = { milligramm: 0.001, миллиграмм: 0.001, mg: 0.001, мг: 0.001, gramm: 1, грамм: 1, gram: 1, gr: 1, гр: 1, gm: 1, g: 1, г: 1, kilogramm: 1000, килограмм: 1000, kilo: 1000, kg: 1000, кг: 1000, tonna: 1e6, тонна: 1e6 };
const TO_MM: Record<string, number> = { millimetr: 1, миллиметр: 1, mm: 1, мм: 1, santimetr: 10, сантиметр: 10, cm: 10, см: 10, metr: 1000, метр: 1000, m: 1000, м: 1000 };

function unitAlternation(units: readonly string[]): string {
  return units.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

function measure(units: readonly string[]): RegExp {
  return new RegExp(`${LEFT}${NUM}\\s*(${unitAlternation(units)})\\.?${RIGHT}`, 'giu');
}

const RE_VOLUME = measure(VOLUME_UNITS);
const RE_WEIGHT = measure(WEIGHT_UNITS);
const RE_LENGTH = measure(LENGTH_UNITS);
const RE_COUNT = measure(COUNT_UNITS);
// "x 6", "6 x", "*6" — a multiplier with no unit attached.
const RE_MULTIPLIER = new RegExp(`${LEFT}[x×*]\\s*${NUM}${RIGHT}|${LEFT}${NUM}\\s*[x×*](?=\\s|$)`, 'giu');
const RE_PERCENT = new RegExp(`${LEFT}${NUM}\\s*%`, 'gu');
// 200x300, 10*20*30. Metal price lists write the sign as a Cyrillic х and list
// alternative wall thicknesses after a slash: "Трубы эл/св 76х2,8/3,0/3,5".
const SIZE = String.raw`\d+(?:[.,]\d+)?(?:/\d+(?:[.,]\d+)?)*`;
const RE_DIMENSIONS = new RegExp(`${LEFT}(${SIZE}(?:\\s*[xх×*]\\s*${SIZE}){1,2})${RIGHT}`, 'giu');
// A pharmacy pack: "№28(2x14)" is 28 tablets in 2 blisters of 14, not a 2x14 size.
// Only the breakdown is taken; "№28" stays in the name, as the classifier writes it.
const RE_PACK_BREAKDOWN = /№\s*(\d+)\s*(\(\s*\d+\s*[xх×*]\s*\d+\s*\))/giu;
// Vendor/model codes: letters glued to digits, e.g. KT2049G, SI1003, ЦЕМ II.
const RE_VENDOR = /(?<![\p{L}\d])(?=[\p{L}]*\d)(?=\d*[\p{L}])[\p{L}\d]*[\p{L}][\p{L}\d]*\d[\p{L}\d]*(?![\p{L}\d])/gu;

const num = (raw: string): number => Number(raw.replace(',', '.'));

export type ExtractedAttrs = {
  volumeMl: number | null;
  weightG: number | null;
  lengthMm: number | null;
  packCount: number | null;
  percent: number | null;
  dimensions: string | null;
  vendorCodes: string[];
};

export type NoiseStripResult = {
  /** The product name with packaging noise removed. */
  core: string;
  attrs: ExtractedAttrs;
  /** Substrings that were pulled out, for explaining a match to the user. */
  removed: string[];
};

const EMPTY_ATTRS: ExtractedAttrs = {
  volumeMl: null, weightG: null, lengthMm: null,
  packCount: null, percent: null, dimensions: null, vendorCodes: [],
};

/**
 * Pulls quantities, pack counts and model codes out of a product name.
 * Order matters: dimensions before multipliers (200x300 is not "x 300"), and
 * measures before vendor codes (500g must not be read as a model number).
 */
export function stripNoise(input: string): NoiseStripResult {
  const attrs: ExtractedAttrs = { ...EMPTY_ATTRS, vendorCodes: [] };
  const removed: string[] = [];
  let work = input;

  const take = (re: RegExp, onMatch: (groups: string[], whole: string) => void): void => {
    work = work.replace(re, (...args: unknown[]) => {
      const whole = String(args[0]);
      const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : ''));
      onMatch(groups, whole);
      removed.push(whole.trim());
      return ' ';
    });
  };

  work = work.replace(RE_PACK_BREAKDOWN, (_whole, count: string, breakdown: string) => {
    if (attrs.packCount === null) attrs.packCount = Number(count);
    removed.push(breakdown.replace(/\s+/g, ''));
    return `№${count} `;
  });
  take(RE_DIMENSIONS, (g) => { if (attrs.dimensions === null && g[0]) attrs.dimensions = g[0].replace(/\s+/g, ''); });
  take(RE_PERCENT, (g) => { if (attrs.percent === null && g[0]) attrs.percent = num(g[0]); });
  take(RE_VOLUME, (g) => {
    const [value, unit] = g;
    if (!value || !unit) return;
    const factor = TO_ML[unit.toLowerCase()];
    if (factor !== undefined && attrs.volumeMl === null) attrs.volumeMl = num(value) * factor;
  });
  take(RE_WEIGHT, (g) => {
    const [value, unit] = g;
    if (!value || !unit) return;
    const factor = TO_G[unit.toLowerCase()];
    if (factor !== undefined && attrs.weightG === null) attrs.weightG = num(value) * factor;
  });
  take(RE_LENGTH, (g) => {
    const [value, unit] = g;
    if (!value || !unit) return;
    const factor = TO_MM[unit.toLowerCase()];
    if (factor !== undefined && attrs.lengthMm === null) attrs.lengthMm = num(value) * factor;
  });
  take(RE_COUNT, (g) => { if (attrs.packCount === null && g[0]) attrs.packCount = num(g[0]); });
  take(RE_MULTIPLIER, (g) => {
    const value = g.find((x) => x !== '');
    if (attrs.packCount === null && value) attrs.packCount = num(value);
  });
  take(RE_VENDOR, (_g, whole) => { attrs.vendorCodes.push(whole); });

  // "1.5L x 6 sht" loses both quantities above and strands the bare "x". An "х"
  // beside a slash is a letter of an abbreviation ("х/к", cold-rolled), not a sign.
  work = work.replace(/(?<![\p{L}\d/])[xх×*](?![\p{L}\d/])/giu, ' ');

  return { core: squeezeWhitespace(work), attrs, removed };
}

/** The text without its pack breakdowns: "№28(2x14)" reads "№28". */
export function withoutPackBreakdown(input: string): string {
  return input.replace(RE_PACK_BREAKDOWN, (_whole, count: string) => `№${count} `);
}

export type Measure = {
  kind: 'volume' | 'weight' | 'length' | 'percent';
  /** In ml, g, mm or %. */
  value: number;
  /** As written ("1,5л", "500 мг"). */
  text: string;
};

// Micrograms are a dose only ("250 мкг/доза"), so stripNoise leaves them in the name.
const RE_MICROGRAM = measure(['микрограмм', 'mikrogramm', 'мкг', 'mkg', 'mcg', 'µg']);
const TO_G_MICRO: Record<string, number> = { микрограмм: 1e-6, mikrogramm: 1e-6, мкг: 1e-6, mkg: 1e-6, mcg: 1e-6, µg: 1e-6 };
const RE_PERCENT_MEASURE = new RegExp(`${LEFT}${NUM}\\s*(%)`, 'gu');

const MEASURES = [
  ['volume', RE_VOLUME, TO_ML],
  ['weight', RE_MICROGRAM, TO_G_MICRO],
  ['weight', RE_WEIGHT, TO_G],
  ['length', RE_LENGTH, TO_MM],
  ['percent', RE_PERCENT_MEASURE, { '%': 1 }],
] as const;

/**
 * Every quantity with a unit in a text, not just the first of each kind as
 * stripNoise keeps: a code's attributes can name a diameter and a wall
 * thickness ("диаметр 15 мм, толщиной стенки 2,5 мм"). Volume is read first
 * so "500 мл" is not also read as metres. A strength in micrograms or per cent
 * ("250 мкг/доза", "0,1%") is a measure too: it tells a drug's doses apart.
 */
export function measuresIn(input: string): Measure[] {
  const out: Measure[] = [];
  let work = input;
  for (const [kind, re, table] of MEASURES) {
    work = work.replace(re, (whole: string, value: string, unit: string) => {
      const factor = (table as Record<string, number>)[unit.toLowerCase()];
      if (factor !== undefined) out.push({ kind, value: num(value) * factor, text: whole.trim() });
      return ' ';
    });
  }
  return out;
}

/**
 * One string per distinct set of attributes, so rows with the same core name
 * are the same product only when their sizes agree too: "Coca-Cola 1.5L" and
 * "Coca Cola 1,5 l" share it, "Труба ВГП 15х2,5" and "Труба ВГП 20х2,5" do not.
 */
export function attrsKey(attrs: ExtractedAttrs): string {
  const parts: string[] = [];
  if (attrs.dimensions !== null) {
    // "5,00х1500" and "5x1500" are one size.
    const dims = attrs.dimensions.toLowerCase().replace(/[х×*]/g, 'x').replace(/\d+(?:[.,]\d+)?/g, (n) => String(num(n)));
    parts.push(`d${dims}`);
  }
  if (attrs.volumeMl !== null) parts.push(`v${attrs.volumeMl}`);
  if (attrs.weightG !== null) parts.push(`w${attrs.weightG}`);
  if (attrs.lengthMm !== null) parts.push(`l${attrs.lengthMm}`);
  if (attrs.packCount !== null) parts.push(`n${attrs.packCount}`);
  if (attrs.percent !== null) parts.push(`p${attrs.percent}`);
  if (attrs.vendorCodes.length > 0) parts.push(`c${attrs.vendorCodes.map((c) => c.toLowerCase()).sort().join(',')}`);
  return parts.join(';');
}

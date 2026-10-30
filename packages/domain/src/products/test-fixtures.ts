// Fixtures for the product module's tests: a fake Tasnif client (never the network) and a seeded
// org with 50 products, aliases, a client's own products and one confirmed mapping. Every org is a
// "test-" org deleted afterwards (dropOrgs).
import { readFileSync } from 'node:fs';
import { db } from '@tasnivo/db';
import { learn } from '../dictionary.js';
import { liveCodes, makeOrg, type TestActor } from '../test-fixtures.js';
import { barcodeKey, productNameKey, unitKeyOf } from './keys.js';
import {
  readCard, readHistory, type TasnifAnswer, type TasnifCard, type TasnifClient, type TasnifGtinHit, type TasnifHistory, type TasnifUnits,
} from './tasnif-client.js';

/** The live answers recorded on 2026-10-23 for 03004413004009066 (three packages: 1062101 шт, 1070335 флакон=14, 1074787 упаковка). */
export const RECORDED_CODE = '03004413004009066';
export function recordedBody(kind: 'card' | 'history'): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${kind}-${RECORDED_CODE}.json`, import.meta.url), 'utf8')) as unknown;
}

/** Answers from maps; counts calls; `down` makes every call unavailable. */
export class FakeTasnifClient implements TasnifClient {
  readonly live = true;
  calls = { card: 0, history: 0, gtin: 0 };
  down = false;
  cards = new Map<string, TasnifCard>();
  histories = new Map<string, TasnifHistory>();
  gtins = new Map<string, TasnifGtinHit>();

  constructor() {
    const card = readCard(recordedBody('card'), RECORDED_CODE);
    const history = readHistory(recordedBody('history'), RECORDED_CODE);
    if (card) this.cards.set(RECORDED_CODE, card);
    if (history) this.histories.set(RECORDED_CODE, history);
  }

  // A code without a recorded answer is "unavailable", not "not found": the fake does not know what
  // tasnif would say, and a not-found answer is cached in mxik_code_state, which parallel test files
  // share (the import checks every code's card since 2026-10-30).
  card(code: string): Promise<TasnifAnswer<TasnifCard>> {
    this.calls.card++;
    if (this.down) return Promise.resolve({ ok: false, reason: 'unavailable' });
    const card = this.cards.get(code);
    return Promise.resolve(card ? { ok: true, value: card } : { ok: false, reason: 'unavailable', detail: 'no recorded answer' });
  }

  history(code: string): Promise<TasnifAnswer<TasnifHistory>> {
    this.calls.history++;
    if (this.down) return Promise.resolve({ ok: false, reason: 'unavailable' });
    const h = this.histories.get(code);
    return Promise.resolve(h ? { ok: true, value: h } : { ok: false, reason: 'unavailable', detail: 'no recorded answer' });
  }

  gtin(barcode: string): Promise<TasnifAnswer<TasnifGtinHit>> {
    this.calls.gtin++;
    if (this.down) return Promise.resolve({ ok: false, reason: 'unavailable' });
    const hit = this.gtins.get(barcode);
    return Promise.resolve(hit ? { ok: true, value: hit } : { ok: false, reason: 'not_found' });
  }

  units(): Promise<TasnifAnswer<TasnifUnits>> {
    return Promise.resolve({ ok: false, reason: 'unavailable' });
  }
}

// ── tasnif.soliq.uz answers recorded 2026-10-30 (fixtures/tasnif/, see fixtures/SOURCES.md) ────

/** A recorded answer by its file name (without .json). */
export function tasnifSample(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/tasnif/${name}.json`, import.meta.url), 'utf8')) as unknown;
}

/** Codes whose card is recorded; any other 17-digit code answers 403 with an empty body, as the live API did. */
export const RECORDED_CARDS = ['00405001001106002', '00405001001000000', '02309001001000000'] as const;
/** Barcodes whose gtin search is recorded as a hit; any other answers the recorded "not data found". */
export const RECORDED_GTINS = ['4780042470127', '4780083550024'] as const;

/**
 * A fetch that answers like tasnif.soliq.uz did on 2026-10-30, from the recorded files: the card
 * (by-mxik), the gtin search, the unit dictionary (10 rows of 90 without `pageSize`, all 90 with it),
 * 401 for the cabinet-only nomenclature; `down` makes it fail like a dead network. Counts requests.
 */
export function tasnifFixtureFetch(options: { down?: boolean } = {}) {
  const seen: string[] = [];
  const reply = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  const fetchFn = ((input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    seen.push(`${url.pathname}${url.search}`);
    if (options.down) return Promise.reject(new TypeError('fetch failed'));
    const q = url.searchParams;
    if (url.pathname.endsWith('/mxik/get/by-mxik')) {
      const code = q.get('mxikCode') ?? '';
      return Promise.resolve((RECORDED_CARDS as readonly string[]).includes(code) ? reply(200, tasnifSample(`by_mxik_${code}`)) : reply(403, ''));
    }
    if (url.pathname.endsWith('/mxik/search/by-params')) {
      const gtin = q.get('gtin');
      if (gtin) return Promise.resolve(reply(200, tasnifSample((RECORDED_GTINS as readonly string[]).includes(gtin) ? `by_params_gtin_${gtin}` : 'by_params_gtin_unknown')));
      // barcode= and internationalCode= are ignored by the API: the unfiltered default page.
      return Promise.resolve(reply(200, tasnifSample('by_params_barcode_4780042470127')));
    }
    if (url.pathname.endsWith('/integration-mxik/references/get/units/all')) {
      const all = Number(q.get('pageSize') ?? 0) >= 90;
      return Promise.resolve(reply(200, tasnifSample(all ? 'units_all_pageSize' : q.get('lang') === 'ru' ? 'units_all_lang_ru' : 'units_all')));
    }
    if (url.pathname.includes('/integration-nomenclature/')) return Promise.resolve(reply(401, ''));
    if (url.pathname.includes('/integration-mxik/get/history/')) return Promise.resolve(reply(200, { success: false, code: 0, reason: 'Mxik code not found!', data: null }));
    return Promise.resolve(reply(404, ''));
  }) as typeof fetch;
  return { fetchFn, seen };
}

/** A GTIN-13 with a correct check digit, from 12 digits. */
export function gtin13(twelve: string): string {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${twelve}${(10 - (sum % 10)) % 10}`;
}

/** 50 distinct products, Russian and Uzbek, the units 1C uses. */
export const PRODUCT_NAMES: readonly [string, string][] = [
  ['Хлеб белый нарезной 400 г', 'шт'], ['Молоко 3,2% 1 л', 'шт'], ['Сахар-песок', 'кг'], ['Мука пшеничная высший сорт', 'кг'], ['Рис девзира', 'кг'],
  ['Масло подсолнечное 5 л', 'шт'], ['Чай зелёный 95', 'шт'], ['Яйца куриные С1', 'шт'], ['Соль поваренная йодированная', 'кг'], ['Макароны спагетти 500 г', 'шт'],
  ['Цемент М-400 50 кг', 'шт'], ['Арматура 12 мм А500С', 'тонна'], ['Кирпич облицовочный красный', 'шт'], ['Гипсокартон 12,5 мм', 'шт'], ['Профиль ПН 27х28', 'шт'],
  ['Краска водоэмульсионная белая 10 кг', 'шт'], ['Саморез по дереву 3,5х35', 'кг'], ['Труба ПВХ 110 мм', 'метр'], ['Кабель ВВГ 3х2,5', 'метр'], ['Розетка двойная белая', 'шт'],
  ['Coca-Cola 1,5 л', 'шт'], ['Coca-Cola 0,5 л', 'шт'], ['Fanta апельсин 1 л', 'шт'], ['Вода Hydrolife 1,5 л', 'шт'], ['Сок яблочный Bliss 1 л', 'шт'],
  ['Shampun Head&Shoulders 400 ml', 'dona'], ['Tish pastasi Colgate 100 ml', 'dona'], ['Kir yuvish kukuni Ariel 3 kg', 'dona'], ['Sovun Duru 90 g', 'dona'], ['Qogʻoz salfetka 100 dona', 'dona'],
  ['Ноутбук Lenovo IdeaPad 3', 'шт'], ['Мышь беспроводная Logitech M185', 'шт'], ['Бумага офисная A4 Svetocopy', 'пачка'], ['Картридж HP 85A', 'шт'], ['Монитор Samsung 24', 'шт'],
  ['Бензин АИ-92', 'литр'], ['Дизельное топливо', 'литр'], ['Моторное масло 5W-40 4 л', 'шт'], ['Антифриз G12 5 л', 'шт'], ['Шина 205/55 R16', 'шт'],
  ['Пакет майка 30х50', 'шт'], ['Скотч упаковочный 48 мм', 'шт'], ['Коробка картонная 40х30х30', 'шт'], ['Плёнка стрейч 500 мм', 'кг'], ['Перчатки нитриловые', 'пара'],
  ['Яблоки Голден', 'кг'], ['Картофель', 'кг'], ['Лук репчатый', 'кг'], ['Морковь', 'кг'], ['Помидоры', 'кг'],
];

export type ProductOrg = TestActor & {
  clientId: string;
  /** product id by index into PRODUCT_NAMES. */
  ids: string[];
  codes: string[];
  barcodes: string[];
  /** The code learned for the confirmed mapping, and the name it was learned under. */
  confirmed: { name: string; unit: string; code: string; productIndex: number };
};

/**
 * Seeds the org: products 0–9 carry barcodes, 10–14 1C codes, 15–24 live MXIK codes (25 shares
 * code 15 under the same unit, a different name), 30–34 one alias each, 40–44 belong to the client, and the firm
 * dictionary maps "Olma sharbati Bliss" to product 24's code (one confirmation).
 */
export async function seedProductOrg(): Promise<ProductOrg> {
  const org = await makeOrg('internal');
  const client = await db.client.create({ data: { orgId: org.orgId, name: 'Client A' } });
  const codes = await liveCodes(12);
  const barcodes = Array.from({ length: 10 }, (_, i) => gtin13(`478000000${String(100 + i)}`));
  const ids: string[] = [];
  for (const [i, [name, unit]] of PRODUCT_NAMES.entries()) {
    const mxik = i >= 15 && i <= 24 ? codes[i - 15] ?? null : i === 25 ? codes[0] ?? null : null;
    const row = await db.product.create({
      data: {
        orgId: org.orgId, clientId: i >= 40 && i <= 44 ? client.id : null, name, normalizedName: productNameKey(name), unitKey: unitKeyOf(unit), unit,
        barcode: i < 10 ? barcodeKey(barcodes[i]).stored : null, onecRef: i >= 10 && i <= 14 ? `00-0000${10 + i}` : null,
        mxik, mxikStatus: mxik ? 'ok' : 'missing', source: 'manual',
      },
    });
    ids.push(row.id);
  }
  for (let i = 30; i <= 34; i++) {
    const alias = `${PRODUCT_NAMES[i]?.[0] ?? ''} (старое наименование)`;
    await db.productAlias.create({ data: { productId: ids[i] ?? '', orgId: org.orgId, alias, normalizedAlias: productNameKey(alias) } });
  }
  const confirmed = { name: 'Olma sharbati Bliss', unit: 'шт', code: codes[9] ?? '', productIndex: 24 };
  await learn(org.orgId, org.userId, [{ rawName: confirmed.name, unit: confirmed.unit, barcode: null, code: confirmed.code }], 'manual');
  return { ...org, clientId: client.id, ids, codes, barcodes, confirmed };
}

// The product catalogue against real-world material (docs/DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md, S3):
// the seven files built from documented header rows (fixtures/make-fixtures.ts, SOURCES.md) read
// through the import's own path, and the tasnif.soliq.uz answers recorded on 2026-10-30
// (fixtures/tasnif/) served by a fake server to the real HTTP client. Each case names the research
// checklist item it covers (tmp/real-docs/products/RESEARCH.md §7, onec §8). No database, no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { accounting } from '@tasnivo/contracts';
import { filenameFromDisposition, contentDisposition } from '../export-filename.js';
import { buildFile, type FileSettings } from '../onec/files.js';
import { planExport, type PlanBatch, type PlanRecord } from '../onec/plan.js';
import { grossPrice, NOMENCLATURE_HEADERS, NOMENCLATURE_SHEETS, nomenclatureKind, vatCaption } from '../onec/sheets.js';
import {
  fileDuplicates, gtinCodeIssues, isServiceCode, readBarcodes, readIkpu, readPrice, readVat, retiredGrace, serviceIssues, splitVat,
} from './checks.js';
import { packagingIssues, unknownCodeVerdict } from './classify.js';
import { headerKey, locateHeader } from './import-map.js';
import { mergeIssues, readProductTable, readRows, suggestMapping } from './import.js';
import type { PackagesState } from './packaging.js';
import { HttpTasnifClient, readCard, readGtin, type TasnifCard } from './tasnif-client.js';
import { tasnifFixtureFetch, tasnifSample } from './test-fixtures.js';
import { normalizeUnit, UNIT } from './units.js';
import { mergedFields } from './upsert.js';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const noSleep = (): Promise<void> => Promise.resolve();

/** A fixture file read exactly as the import reads an upload, with the mapping it would suggest. */
async function imported(file: string) {
  const bytes = readFileSync(new URL(file, FIXTURES));
  const table = await readProductTable(bytes, file);
  const { mapping } = suggestMapping(table.headers);
  const { kept, dropped } = readRows(table.rows, mapping, { headers: table.headers, numberCells: table.numberCells });
  return { table, mapping, kept, dropped, codes: (i: number) => kept[i]?.issues.map((x) => x.code) ?? [] };
}

/** The mapped header names per field: what a reviewer sees in the wizard. */
function mappedNames(headers: readonly string[], mapping: Record<string, number>): Record<string, string> {
  return Object.fromEntries(Object.entries(mapping).filter(([, i]) => i >= 0).map(([f, i]) => [f, headers[i] ?? '']));
}

/** The real card of a code as the client reads it (fixtures/tasnif/by_mxik_<code>.json). */
const card = (code: string): TasnifCard => {
  const c = readCard(tasnifSample(`by_mxik_${code}`), code);
  assert.ok(c, `recorded card ${code}`);
  return c;
};
const live = (code: string): PackagesState => ({ source: 'live', packages: card(code).packages.map((p) => ({ ...p, nameUz: null, nameRu: null })) });

describe('product files with documented header rows (products §4, §7.29)', () => {
  it('maps the six Excel layouts and the CSV without manual work, extra columns left unmapped', async () => {
    // products §7.29: RU (MoySklad UZ card, 1C list), UZ Latin (buline), UZ Cyrillic, Uzum, Click fiscal, magicstore CSV.
    const moysklad = await imported('moysklad-uz.xlsx');
    assert.deepEqual(mappedNames(moysklad.table.headers, moysklad.mapping), {
      name: 'Наименование', mxik: 'ИКПУ (MXIK)', packageCode: 'Код упаковки ТАСНИФ', unit: 'Единицы измерения', barcode: 'Штрихкод', price: 'Цена продажи', vat: 'НДС',
    });
    const onec = await imported('onec-nomenclature.xlsx');
    assert.deepEqual(mappedNames(onec.table.headers, onec.mapping), {
      name: 'Наименование', onecRef: 'Код', article: 'Артикул', mxik: 'Код из классификатора', packageCode: 'Упаковка (ЭДО)', unit: 'Единица измерения',
      barcode: 'Штрихкод', vat: 'Ставка НДС',
    });
    const buline = await imported('buline-uz-latin.xlsx');
    assert.deepEqual(mappedNames(buline.table.headers, buline.mapping), {
      name: 'Nom', article: 'Ichki kod', mxik: 'MXIK', unit: "O'lchov birligi", barcode: 'GTIN, dona', price: 'Narx', vat: 'QQS',
    });
    const cyr = await imported('uz-cyrillic.xlsx');
    assert.deepEqual(mappedNames(cyr.table.headers, cyr.mapping), {
      name: 'Номи', mxik: 'МХИК коди', packageCode: 'Қадоқ коди', unit: 'Ўлчов бирлиги', barcode: 'Штрих коди', price: 'Нарх (ҚҚС билан)', vat: 'ҚҚС',
    });
    const uzum = await imported('uzum-seller.xlsx');
    assert.deepEqual(mappedNames(uzum.table.headers, uzum.mapping), {
      name: 'Наименование товара', article: 'SKU товара', mxik: 'ИКПУ', barcode: 'Штрихкод', price: 'Цена', vat: 'НДС',
    });
    assert.equal(uzum.table.headers.length, 18, 'the 12 other Uzum columns are read and left unmapped');
    const click = await imported('click-fiscal.xlsx');
    assert.deepEqual(mappedNames(click.table.headers, click.mapping), {
      name: 'Name', mxik: 'SPIC', packageCode: 'PackageCode', unit: 'Units', price: 'GoodPrice', vat: 'VATPercent',
    });
    const magic = await imported('magicstore-ikpu.csv');
    assert.deepEqual(mappedNames(magic.table.headers, magic.mapping), { name: 'Название', article: 'ID', mxik: 'ИКПУ', packageCode: 'Код упаковки' });
  });

  it('finds the header below caption rows (1C list) and below a title row as wide as the table', async () => {
    // products §7.29, onec §8.17: the header row is not on row 1.
    const onec = await imported('onec-nomenclature.xlsx');
    assert.equal(onec.table.headers[0], 'Код');
    assert.equal(onec.kept.length, 4);
    assert.equal(onec.kept[0]?.record.onecRef, '00-00000001');
    // A hint row filling every column (a template's field notes) above the real header.
    const located = locateHeader(
      ['Обязательное поле', 'Обязательное поле', 'Необязательное', 'Необязательное'],
      [['Наименование', 'ИКПУ', 'Штрихкод', 'Цена'], ['Масло', '00405001001106002', '4780042470127', '28500']],
    );
    assert.deepEqual(located.headers, ['Наименование', 'ИКПУ', 'Штрихкод', 'Цена']);
    assert.equal(located.rows.length, 1);
    assert.equal(located.skipped, 1);
  });

  it('keeps the Артикул (B7) and the price and VAT the file states', async () => {
    // products §7.18, onec §8.7: «Артикул» reaches the record; the price is tiyin-exact, GoodPrice is tiyin.
    const onec = await imported('onec-nomenclature.xlsx');
    assert.deepEqual(onec.kept.map((k) => k.record.article), ['LAC-200', 'LAC-400', 'SRV-TR', 'BUT-KG']);
    assert.deepEqual(onec.kept.map((k) => k.record.vatRate), ['12', '12', 'without', '12']);
    const click = await imported('click-fiscal.xlsx');
    assert.deepEqual(click.kept.map((k) => [k.record.price, k.record.priceIncludesVat]), [['28500.00', true], ['1500000.00', true], ['96000.00', true]]);
    const moysklad = await imported('moysklad-uz.xlsx');
    assert.deepEqual(moysklad.kept.map((k) => k.record.price), ['28500.00', '96000.00', '41250.50', '9990.00', '1140000.00']);
    assert.equal(moysklad.kept[0]?.record.priceIncludesVat, null, '«Цена продажи» does not say whether VAT is in');
    const cyr = await imported('uz-cyrillic.xlsx');
    assert.equal(cyr.kept[0]?.record.priceIncludesVat, true, '«Нарх (ҚҚС билан)»');
  });
});

describe('ИКПУ cells damaged by Excel (products §7.1)', () => {
  it('reports a lost leading zero and a 17-digit number cell, never pads', async () => {
    // products §7.1: buline.uz stores MXIK as numbers — the damage it warns about.
    const buline = await imported('buline-uz-latin.xlsx');
    const lactel = buline.kept[0];
    assert.equal(lactel?.record.mxik, null, 'never silently padded');
    assert.equal(lactel?.rawMxik, '405001001106002');
    assert.deepEqual(lactel?.issues.find((i) => i.code === 'mxik_leading_zero')?.params, { value: '405001001106002', restored: '00405001001106002' });
    assert.equal(lactel?.issues[0]?.severity, 'error');
    // 10112008001000001 typed as a number: a double keeps 10112008001000000 — a valid-looking other code.
    const transport = buline.kept[2];
    assert.equal(transport?.record.mxik, '10112008001000000');
    assert.deepEqual(transport?.issues.map((i) => [i.code, i.severity]), [['mxik_number_cell', 'warning']]);
    // The EAN-8 cigarette code lost one zero (16 digits).
    assert.equal(buline.codes(3)[0], 'mxik_leading_zero');
  });

  it('reports scientific notation from a CSV saved by Excel', async () => {
    // products §7.1: "4,05001E+14" and "2.30900100100000E+15" (comma and dot locales).
    const magic = await imported('magicstore-ikpu.csv');
    assert.deepEqual(magic.kept.map((k) => k.issues.map((i) => i.code)), [['mxik_scientific'], ['mxik_leading_zero'], [], ['mxik_scientific']]);
    assert.deepEqual(magic.kept.map((k) => k.record.mxik), [null, null, '03304020001027003', null]);
    assert.deepEqual(readIkpu("'00405001001106002"), { kind: 'ok', code: '00405001001106002' }, 'Excel text apostrophe');
    assert.deepEqual(readIkpu('004.050.010.011.060.02'), { kind: 'ok', code: '00405001001106002' });
    assert.equal(readIkpu('4.05001001106E+16').kind, 'scientific');
    assert.equal(readIkpu('ABC').kind, 'malformed');
    // The classification's own "malformed" is not said twice next to the cell's issue.
    const merged = mergeIssues(magic.kept[0]?.issues ?? [], [{ code: 'mxik_malformed', severity: 'error', field: 'mxik' }, { code: 'marking_required', severity: 'info' }]);
    assert.deepEqual(merged.map((i) => i.code), ['mxik_scientific', 'marking_required']);
  });
});

describe('barcodes (products §7.13, §7.14, §7.15, §7.16)', () => {
  it('splits several barcodes, flags in-store and bad check digits, keeps the first valid one', async () => {
    const uzum = await imported('uzum-seller.xlsx');
    // §7.16: "4780042470127;4780042470134" → two valid GTINs, the first kept.
    assert.equal(uzum.kept[0]?.record.barcode, '4780042470127');
    assert.deepEqual(uzum.kept[0]?.issues.find((i) => i.code === 'barcode_several')?.params, { count: 2, kept: '4780042470127' });
    // §7.14: a 29-prefix weighed-goods label is not a GTIN and is never looked up.
    assert.deepEqual(uzum.codes(1), ['barcode_internal']);
    assert.deepEqual(readBarcodes(uzum.kept[1]?.record.barcode).lookup, []);
    // §7.13: the antiseptic's GTIN with a wrong last digit (real: 4780083550024).
    assert.deepEqual(uzum.kept[2]?.issues.map((i) => [i.code, i.severity]), [['barcode_invalid', 'warning']]);
    // §7.13/§7.15: EAN-8 (Pall Mall 47801271, a real tasnif GTIN) is valid; 11 digits, letters are not; a spaced EAN-13 is one code.
    assert.deepEqual(readBarcodes('47801271').lookup, ['47801271']);
    assert.equal(readBarcodes('47800424701').issues[0]?.code, 'barcode_bad_length');
    assert.equal(readBarcodes('GTIN4780042470127').issues[0]?.code, 'barcode_not_numeric');
    assert.deepEqual(readBarcodes('478 0042 470127'), { primary: '4780042470127', lookup: ['4780042470127'], issues: [] });
    assert.deepEqual(readBarcodes('4780042470127\n4780042470134').lookup, ['4780042470127', '4780042470134']);
  });

  it('compares the row code with the code tasnif holds for its barcode (real gtin answers)', async () => {
    // products §7.3, §7.4, §7.5, §7.33: the gtin search, recorded live; success:false is "not found".
    const { fetchFn, seen } = tasnifFixtureFetch();
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, minGapMs: 0 });
    const hit = await client.gtin('4780042470127');
    assert.ok(hit.ok);
    assert.equal(hit.value.mxikCode, '00405001001106002');
    assert.deepEqual(await client.gtin('4780000000000'), { ok: false, reason: 'not_found' });
    assert.ok(seen.every((u) => u.includes('gtin=')), 'barcode= and internationalCode= are ignored by tasnif: only gtin= is asked');
    // An unfiltered page (what barcode= returns) never counts as a hit; an EAN-8 is found on the cigarette page.
    assert.equal(readGtin(tasnifSample('by_params_barcode_4780042470127'), '4780042470127'), null);
    assert.equal(readGtin(tasnifSample('by_params_text_sigaret'), '47801271')?.mxikCode, '02402001001001025');
    assert.equal(readGtin(tasnifSample('by_params_mxik_00405001001106002'), '4780042470127')?.mxikCode, '00405001001106002');
    assert.equal(readGtin(tasnifSample('by_params_mxik_02520001006000000'), '4780042470127'), null);
    const gtinCode = hit.value.mxikCode;
    assert.deepEqual(gtinCodeIssues('00405001001106002', '4780042470127', gtinCode), []);
    assert.deepEqual(gtinCodeIssues('00405001001000000', '4780042470127', gtinCode).map((i) => [i.code, i.severity, i.suggestion]), [['gtin_brand_code_exists', 'warning', gtinCode]]);
    assert.deepEqual(gtinCodeIssues('01701001001000000', '4780042470127', gtinCode).map((i) => [i.code, i.severity]), [['mxik_base_mismatch', 'error']]);
    assert.deepEqual(gtinCodeIssues('00405001001106003', '4780042470127', gtinCode).map((i) => i.code), ['gtin_code_conflict']);
    assert.deepEqual(gtinCodeIssues(null, '4780042470127', gtinCode).map((i) => [i.code, i.severity]), [['gtin_has_code', 'info']]);
    assert.deepEqual(gtinCodeIssues('01701001001000000', '4780000000000', null), []);
  });
});

describe('packages and units over real tasnif cards (products §7.7, §7.8, §7.9, §7.10, §7.12)', () => {
  it('accepts the brand code\'s own consumer pack and refuses another unit and another code\'s package', () => {
    const lactel = live('00405001001106002');
    // §7.12: the package name is the tasnif text, not a free unit.
    assert.deepEqual(packagingIssues({ packageCode: '1497381', unit: 'шт' }, '00405001001106002', lactel), { issues: [], packageName: 'шт. (упаковка) 200 грамм' });
    // §7.10: a GTIN code's unit is strictly the piece (its consumer pack): kg is an error.
    const kg = packagingIssues({ packageCode: '1497381', unit: 'кг' }, '00405001001106002', lactel).issues;
    assert.deepEqual(kg.map((i) => [i.code, i.severity]), [['package_unit_conflict', 'warning'], ['unit_fixed', 'error']]);
    // §7.7: the 40-pack box of the brand code on the base code: not in its packages[] (live list → error).
    const base = live('00405001001000000');
    assert.deepEqual(packagingIssues({ packageCode: '1498196', unit: 'шт' }, '00405001001000000', base).issues.map((i) => [i.code, i.severity]), [['package_not_of_code', 'error']]);
    // From a cached list the taxpayer may have created a package since: a warning only.
    assert.equal(packagingIssues({ packageCode: '1498196', unit: 'шт' }, '00405001001000000', { ...base, source: 'cache' }).issues[0]?.severity, 'warning');
  });

  it('derives the package from the unit when the cell is empty, and says when the unit is not the code\'s', () => {
    // §7.8: the plain «килограмм» package of the base butter code (72 packages) and of pet food.
    const base = live('00405001001000000');
    assert.equal(packagingIssues({ packageCode: null, unit: 'кг' }, '00405001001000000', base).issues[0]?.suggestion, '1425568');
    assert.equal(packagingIssues({ packageCode: null, unit: 'шт' }, '00405001001000000', base).issues[0]?.suggestion, '1425573');
    const pet = live('02309001001000000');
    assert.equal(packagingIssues({ packageCode: null, unit: 'kg' }, '02309001001000000', pet).issues[0]?.suggestion, '1417303');
    assert.equal(packagingIssues({ packageCode: null, unit: 'литр' }, '02309001001000000', pet).issues[0]?.suggestion, '1526307');
    // §7.10: «метр» is attached to neither code.
    const metre = packagingIssues({ packageCode: null, unit: 'метр' }, '00405001001000000', base).issues.find((i) => i.code === 'unit_not_allowed');
    assert.equal(metre?.severity, 'warning');
    assert.match(String(metre?.params?.['expected']), /килограмм/);
  });

  it('normalises the units people write onto the tasnif ids (§1.4)', () => {
    // §7.9: шт / дона / штук / pcs → 1; кг → 5; л → 23; г → 4; т → 7; м → 11; м2 → 16; м3 → 20; мл → 22; услуга → 25; сум → 113.
    const ids = (words: string[]) => words.map((w) => normalizeUnit(w)?.id ?? null);
    assert.deepEqual(ids(['шт', 'шт.', 'дона', 'штук', 'pcs', 'dona']), [1, 1, 1, 1, 1, 1]);
    assert.deepEqual(ids(['кг', 'килограмм', 'kg', 'л', 'литр', 'г', 'грамм', 'т', 'тонна']), [5, 5, 5, 23, 23, 4, 4, 7, 7]);
    assert.deepEqual(ids(['м', 'метр', 'м2', 'кв.м', 'м3', 'мл', 'услуга', 'хизмат (сўм)', 'услуга (сум)', 'сум']), [11, 11, 16, 16, 20, 22, 25, 25, 25, 113]);
    assert.equal(normalizeUnit('коробка'), null, 'a container is not a unit');
    // The real unit dictionary, all 90 ids, contains every id the table uses.
    const all = new Set((tasnifSample('units_all_pageSize') as { data: { id: number }[] }).data.map((u) => u.id));
    for (const u of Object.values(UNIT)) assert.ok(all.has(u.id), `unit ${u.id} in the tasnif dictionary`);
  });
});

describe('tasnif client edge answers (products §7.2, §7.33, §7.34)', () => {
  it('tells an unknown code (403) from a dead network, without retrying a 403', async () => {
    // §7.2/§7.33: by-mxik answered 403 with an empty body for 02520001006000000 on 2026-10-30.
    const { fetchFn, seen } = tasnifFixtureFetch();
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, minGapMs: 0 });
    const gone = await client.card('02520001006000000');
    assert.deepEqual(gone, { ok: false, reason: 'not_found' });
    assert.equal(seen.length, 1, 'a 403 is an answer, not retried');
    await client.card('02520001006000000');
    assert.equal(seen.length, 1, 'and remembered');
    assert.deepEqual(unknownCodeVerdict(gone), { code: 'mxik_not_found', severity: 'error', api: 'not_found' });
    const down = new HttpTasnifClient({ fetch: tasnifFixtureFetch({ down: true }).fetchFn, sleep: noSleep, minGapMs: 0 });
    const outage = await down.card('02520001006000000');
    assert.equal(outage.ok ? 'ok' : outage.reason, 'unavailable');
    assert.deepEqual(unknownCodeVerdict(outage), { code: 'mxik_unconfirmed', severity: 'error', api: 'unavailable' });
    // A recorded card: the code exists at tasnif even when our classifier copy lacks it.
    const known = await client.card('00405001001106002');
    assert.ok(known.ok);
    assert.equal(known.value.packages.length, 2);
    assert.equal(unknownCodeVerdict(known).code, 'mxik_not_in_copy');
  });

  it('reads all 90 units with pageSize=100 and refuses a short page', async () => {
    // §7.34: units/all returns 10 of 90 by default; recordTotal must equal the rows received.
    const { fetchFn, seen } = tasnifFixtureFetch();
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, minGapMs: 0 });
    const units = await client.units();
    assert.ok(units.ok);
    assert.equal(units.value.units.length, 90);
    assert.equal(units.value.recordTotal, 90);
    assert.match(seen[0] ?? '', /pageSize=100/);
    // A server that ignores pageSize (the default page): incomplete, not a 10-unit dictionary.
    const shortPage = (() => Promise.resolve(new Response(JSON.stringify(tasnifSample('units_all')), { status: 200 }))) as typeof fetch;
    const short = await new HttpTasnifClient({ fetch: shortPage, sleep: noSleep, minGapMs: 0 }).units();
    assert.deepEqual(short, { ok: false, reason: 'incomplete', detail: '10 of 90' });
  });

  it('answers "needs a cabinet token" for /integration-nomenclature (401), once', async () => {
    // §7.33: 401 on the taxpayer-only endpoint is not "not found" and is never retried.
    const { fetchFn, seen } = tasnifFixtureFetch();
    const client = new HttpTasnifClient({ fetch: fetchFn, sleep: noSleep, minGapMs: 0, retries: 2 });
    assert.deepEqual(await client.nomenclature('00405001001106002'), { ok: false, reason: 'needs_token', detail: 'HTTP 401' });
    assert.equal(seen.length, 1);
    await client.nomenclature('00405001001106002');
    assert.equal(seen.length, 2, 'not cached as an answer: a token may be configured later');
  });
});

describe('row rules (products §7.17, §7.19, §7.20, §7.23, §7.30, §7.31)', () => {
  it('reports duplicates within the file', async () => {
    // §7.17: the same name + code + package twice; one barcode on three rows; one name with two codes.
    const cyr = await imported('uz-cyrillic.xlsx');
    assert.deepEqual(cyr.kept[3]?.issues.map((i) => [i.code, i.params?.['row']]), [['duplicate_row', 1]]);
    const uzum = await imported('uzum-seller.xlsx');
    assert.deepEqual([uzum.codes(3), uzum.codes(4)], [['duplicate_barcode'], ['duplicate_barcode']]);
    const named = fileDuplicates([
      { name: 'Масло сливочное', barcode: null, mxik: '00405001001000000', packageCode: null },
      { name: 'масло  сливочное', barcode: null, mxik: '00405001001106002', packageCode: null },
    ]);
    assert.deepEqual(named.get(1)?.map((i) => i.code), ['duplicate_name']);
    assert.equal(named.has(0), false, 'the first occurrence is not flagged');
  });

  it('reads prices to tiyin and VAT cells to the rate the ЭСФ carries', () => {
    // §7.19: separators, currency words, >2 decimals flagged and rounded half up.
    assert.deepEqual(readPrice('1 234 567,89'), { price: '1234567.89', issues: [] });
    assert.deepEqual(readPrice('1,234,567.89').price, '1234567.89');
    assert.deepEqual(readPrice('12 000 so‘m').price, '12000.00');
    const sharp = readPrice('15000,555');
    assert.equal(sharp.price, '15000.56');
    assert.deepEqual(sharp.issues.map((i) => [i.code, i.params?.['rounded']]), [['price_precision', '15000.56']]);
    assert.equal(readPrice('по договору').issues[0]?.code, 'price_unreadable');
    // §5: 12/112 from the gross, 12 % on the net, in tiyin.
    assert.deepEqual(splitVat(11_200n, 12, true), { net: 10_000n, vat: 1_200n, gross: 11_200n });
    assert.deepEqual(splitVat(2_850_000n, 12, true), { net: 2_544_643n, vat: 305_357n, gross: 2_850_000n });
    assert.deepEqual(splitVat(10_000n, 12, false), { net: 10_000n, vat: 1_200n, gross: 11_200n });
    // §7.20: every documented spelling.
    const rate = (v: string) => readVat(v).vatRate;
    assert.deepEqual(['12', '12%', 'QQS 12%', 'НДС 12 %', '0.12', '0', '0%', 'без НДС', 'Без налога', 'QQSsiz', 'ҚҚСсиз', ''].map(rate),
      ['12', '12', '12', '12', '12', '0', '0', 'without', 'without', 'without', 'without', null]);
    assert.deepEqual(readVat('15').issues.map((i) => i.code), ['vat_rate_unusual']);
    assert.equal(readVat('двенадцать').issues[0]?.code, 'vat_unreadable');
  });

  it('flags service rows counted in goods units and goods counted as a service', async () => {
    // §7.23, onec §8.10: service codes start with 1; a service is counted in «хизмат (сўм)».
    assert.equal(isServiceCode('10112008001000001'), true);
    assert.equal(isServiceCode('00405001001000000'), false);
    const click = await imported('click-fiscal.xlsx');
    const transport = click.kept[1]?.record;
    assert.deepEqual(serviceIssues(transport?.mxik ?? null, transport?.unit ?? null).map((i) => i.code), ['service_unit']);
    assert.deepEqual(serviceIssues('10112008001000001', 'услуга'), []);
    assert.deepEqual(serviceIssues('00405001001000000', 'услуга').map((i) => i.code), ['service_unit_on_goods']);
  });

  it('keeps a changed code usable for 30 days, then not', () => {
    // §7.31, onec §8.12: PKM 263 п.42 — changes take effect 30 days after publication.
    const retired = new Date('2026-10-20T00:00:00Z');
    assert.deepEqual(retiredGrace(retired, new Date('2026-10-30T00:00:00Z')), { inGrace: true, until: '2026-11-19' });
    assert.equal(retiredGrace(retired, new Date('2026-11-20T00:00:00Z')).inGrace, false);
  });

  it('never clears a saved value from an empty cell unless the importer opted in', () => {
    // §7.30: magicstore clears on an empty cell; here it is a choice per mapped column.
    const saved = {
      onecRef: '00-1', article: 'LAC-200', mxik: '00405001001106002', mxikName: 'Lactel', packageCode: '1497381', packageName: 'шт. (упаковка) 200 грамм',
      unit: 'шт', barcode: '04780042470127', price: '28500.00', priceIncludesVat: true, vatRate: '12',
    };
    const empty = { onecRef: null, article: null, mxik: null, mxikName: null, packageCode: null, packageName: null, unit: null, barcode: null, price: null, priceIncludesVat: null, vatRate: null };
    assert.deepEqual(mergedFields(saved, empty), saved);
    const cleared = mergedFields(saved, empty, new Set(['packageCode', 'price']));
    assert.equal(cleared.packageCode, null);
    assert.equal(cleared.packageName, null, 'the name goes with its code');
    assert.equal(cleared.price, null);
    assert.equal(cleared.priceIncludesVat, null);
    assert.equal(cleared.mxik, '00405001001106002', 'a field not opted in is kept');
    assert.equal(mergedFields(saved, { ...empty, article: 'LAC-200B' }).article, 'LAC-200B');
  });
});

describe('1C nomenclature file from a real-layout import (onec §8.1, §8.7, §8.10; B7, B8)', () => {
  const NOW = new Date('2026-10-30T09:00:00Z');
  const settings: FileSettings = { bankKeys: 'standard', ownerName: 'ООО «Тасниво Тест»', filename: 'Товары.xlsx', wholeStatement: true, now: NOW };
  const batch: PlanBatch = { id: 'b-real', kind: 'product_catalog', meta: { source: 'xlsx', headers: [], columnMap: {}, catalogId: null } };

  it('writes the 1C captions, Артикул, codes as text, and services on their own sheet', async () => {
    const onec = await imported('onec-nomenclature.xlsx');
    // Reviewed and approved, as applyProductBatch leaves clean rows (an undecided valid record never leaves, B5).
    const records: PlanRecord[] = onec.kept.map((k, i) => ({
      id: `r${i}`, rowIndex: i, status: 'valid', payload: accounting.ProductRecord.parse(k.record), issues: [], fingerprint: `f${i}`, decision: { action: 'approve' },
    }));
    const plan = planExport(batch, records, 'nomenclature_xlsx', undefined, { exportedElsewhere: new Map() });
    const file = await buildFile(batch, plan, 'nomenclature_xlsx', settings);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const goods = wb.getWorksheet(NOMENCLATURE_SHEETS.goods);
    const services = wb.getWorksheet(NOMENCLATURE_SHEETS.services);
    assert.ok(goods && services);
    // onec §8.7: every header is a 1C caption.
    assert.deepEqual((goods.getRow(1).values as unknown[]).slice(1), [...NOMENCLATURE_HEADERS]);
    for (const h of ['Наименование', 'Полное наименование', 'Артикул', 'Штрихкод', 'Единица измерения', 'Ставка НДС', 'Цена', 'Код из классификатора', 'Код упаковки']) {
      assert.ok(NOMENCLATURE_HEADERS.map(headerKey).includes(headerKey(h)), h);
    }
    // onec §8.10: the transport service is on «Услуги», never among the goods.
    assert.equal(goods.rowCount, 4);
    assert.equal(services.rowCount, 2);
    assert.equal(services.getCell('B2').value, '10112008001000001');
    assert.equal(services.getCell('J2').value, 'Услуга');
    assert.equal(services.getCell('H2').value, 'Без НДС');
    // B7: «Артикул» is filled; onec §8.1: codes stay text with their leading zeros.
    assert.equal(goods.getCell('F2').value, 'LAC-200');
    assert.equal(goods.getCell('B2').value, '00405001001106002');
    assert.equal(goods.getCell('B2').numFmt, '@');
    assert.equal(goods.getCell('E2').value, '4780042470127');
    assert.equal(goods.getCell('H2').value, '12%');
    assert.equal(goods.getCell('G2').value, 'Масло Lactel 200 г', 'the full name is the name when the list has no other');
    // B8: the download name keeps its Cyrillic (the ASCII fallback was taken before).
    assert.equal(file.filename, 'Товары-nomenklatura.xlsx');
    assert.equal(filenameFromDisposition(contentDisposition('attachment', file.filename)), 'Товары-nomenklatura.xlsx');
  });

  it('prices the sale price with VAT and names the rate as 1C does', () => {
    // onec §8.6, products §5: a net price gets its 12 %; a gross or unknown one is written as given.
    assert.equal(grossPrice({ price: '10000.00', priceIncludesVat: false, vatRate: '12' }), '11200.00');
    assert.equal(grossPrice({ price: '28500.00', priceIncludesVat: true, vatRate: '12' }), '28500.00');
    assert.equal(grossPrice({ price: '28500.00', priceIncludesVat: null, vatRate: '12' }), '28500.00');
    assert.equal(grossPrice({ price: '9990.00', priceIncludesVat: false, vatRate: 'without' }), '9990.00');
    assert.equal(grossPrice({ price: '0.05', priceIncludesVat: false, vatRate: '12' }), '0.06');
    assert.deepEqual(['12', '0', 'without', '15', null].map((r) => vatCaption(r)), ['12%', '0%', 'Без НДС', '15%', '']);
    assert.equal(nomenclatureKind(null, 'хизмат'), 'service');
    assert.equal(nomenclatureKind('00405001001000000', 'услуга'), 'goods', 'the code decides first (BP UZ 3.0.63)');
  });
});

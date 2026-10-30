// Writes the product catalogue files the import tests read:
//
//   npx tsx packages/domain/src/products/fixtures/make-fixtures.ts
//
// HEADER ROWS ARE DOCUMENTED, CELL VALUES ARE BUILT. No real product Excel could be downloaded
// (Telegram attachments and cabinet-only templates, tmp/real-docs/products/RESEARCH.md §6), so each
// file uses exactly the column names one documented source lists (§4; SOURCES.md names the URL per
// file) and fills them with the real codes, packages and barcodes tasnif.soliq.uz answered on
// 2026-10-30 (fixtures/tasnif/), plus the damage the checklist (§7) asks the import to catch: codes
// stored as numbers, scientific notation, several barcodes in a cell, in-store barcodes, VAT words,
// prices with too many decimals, duplicates. Products are generic (butter, antiseptic, pet food,
// transport service); no person or company data.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const DIR = dirname(fileURLToPath(import.meta.url));

/** A GTIN-13 with its check digit, from 12 digits (GS1 mod 10). */
const ean13 = (twelve: string): string => {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${twelve}${(10 - (sum % 10)) % 10}`;
};

/** Real answers of tasnif.soliq.uz (fixtures/tasnif/, 2026-10-30). */
export const REAL = {
  butter200: { code: '00405001001106002', gtin: '4780042470127', consumerPack: '1497381', box40: '1498196' },
  butter400: { code: '00405001001106003', gtin: '4780042470134' },
  butterBase: { code: '00405001001000000', kgPackage: '1425568', piecePackage: '1425573' },
  antiseptic: { code: '03304020001027003', gtin: '4780083550024' },
  petFoodBase: { code: '02309001001000000', kgPackage: '1417303' },
  cigarettes: { code: '02402001001001025', ean8: '47801271' },
  transport: { code: '10112008001000001' },
  sugar: { code: '01701001001000000' },
} as const;

/** A weighed-goods label (prefix 29, GS1 restricted circulation; research §3 layout "29 + item + weight"). */
export const IN_STORE = ean13('291234700156');

async function write(name: string, rows: readonly (readonly (string | number | null)[])[], options: { above?: readonly (readonly string[])[]; text?: readonly number[] } = {}): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Tasnivo fixtures';
  wb.created = new Date('2026-10-30T00:00:00Z');
  wb.modified = wb.created;
  const ws = wb.addWorksheet('Лист1');
  for (const r of options.above ?? []) ws.addRow([...r]);
  for (const r of rows) ws.addRow([...r]);
  // Columns kept as text in the source system (codes typed as text), the rest as Excel stores them.
  for (const c of options.text ?? []) ws.getColumn(c).numFmt = '@';
  await wb.xlsx.writeFile(join(DIR, name));
}

// (1) MoySklad, Uzbek product card + its Excel import (support.moysklad.ru 19770742552978, 115006434208).
async function moysklad(): Promise<void> {
  await write('moysklad-uz.xlsx', [
    ['Наименование', 'ИКПУ (MXIK)', 'Код упаковки ТАСНИФ', 'Штрихкод ТАСНИФ', 'Фасовка', 'Тип учета', 'Единицы измерения', 'НДС', 'Штрихкод', 'Цена продажи'],
    ['Масло сливочное Lactel 200 г', REAL.butter200.code, REAL.butter200.consumerPack, REAL.butter200.gtin, '200 г', 'Штучный', 'шт', '12', REAL.butter200.gtin, '28 500,00'],
    ['Масло сливочное весовое', REAL.butterBase.code, '', '', '', 'Весовой', 'кг', '12', '', '96 000,00'],
    ['Корм для кошек сухой', REAL.petFoodBase.code, '', '', '', 'Весовой', 'кг', '0', '', '41 250,5'],
    ['Антисептик для рук 50 мл', REAL.antiseptic.code, '', REAL.antiseptic.gtin, '50 мл', 'Штучный', 'шт', 'без НДС', REAL.antiseptic.gtin, '9 990,00'],
    ['Масло сливочное Lactel 200 г (коробка)', REAL.butterBase.code, REAL.butter200.box40, '', '', 'Штучный', 'шт', '12', '', '1 140 000,00'],
  ], { text: [2, 3, 4, 9] });
}

// (2) 1C «Номенклатура» list saved to Excel: caption rows above the header, the 1C captions (onec §1.2, §8.7).
async function onecList(): Promise<void> {
  await write('onec-nomenclature.xlsx', [
    ['Код', 'Наименование', 'Полное наименование', 'Артикул', 'Единица измерения', 'Ставка НДС', 'Штрихкод', 'Код из классификатора', 'Упаковка (ЭДО)'],
    ['00-00000001', 'Масло Lactel 200 г', 'Масло сливочное Lactel 200 г', 'LAC-200', 'шт', '12%', REAL.butter200.gtin, REAL.butter200.code, REAL.butter200.consumerPack],
    ['00-00000002', 'Масло Lactel 400 г', 'Масло сливочное Lactel 82,5% 400 г', 'LAC-400', 'шт', '12%', REAL.butter400.gtin, REAL.butter400.code, ''],
    ['00-00000003', 'Перевозка международная', 'Услуги международной перевозки грузов', 'SRV-TR', 'услуга', 'Без НДС', '', REAL.transport.code, ''],
    ['00-00000004', 'Масло сливочное весовое', 'Масло сливочное весовое', 'BUT-KG', 'кг', '12%', '', REAL.butterBase.code, ''],
  ], { above: [['Номенклатура'], ['Отбор: Вид номенклатуры = Товары, Услуги'], []], text: [1, 4, 7, 8, 9] });
}

// (3) buline.uz recommended card, Uzbek Latin; MXIK kept as NUMBERS (the damage buline warns about).
async function bulineLatin(): Promise<void> {
  await write('buline-uz-latin.xlsx', [
    ['Ichki kod', 'Nom', 'GTIN, dona', 'GTIN, quti', 'MXIK', "O'lchov birligi", 'Narx', 'QQS'],
    ['A-001', 'Sariyogʻ Lactel 200 g', REAL.butter200.gtin, '', Number(REAL.butter200.code), 'dona', 28500, 0.12],
    ['A-002', 'Sariyogʻ tarozida', '', '', Number(REAL.butterBase.code), 'kg', 96000, 0.12],
    ['A-003', 'Xalqaro yuk tashish xizmati', '', '', Number(REAL.transport.code), 'xizmat', 1500000, 0],
    ['A-004', 'Sigaret Pall Mall', REAL.cigarettes.ean8, '', Number(REAL.cigarettes.code), 'dona', 18000, 0.12],
  ]);
}

// (4) Uzbek Cyrillic: the common vocabulary of §4 (Nomi, MXIK kodi, Qadoq kodi, Oʻlchov birligi, Shtrix kod, Narx, QQS) in Cyrillic.
async function uzCyrillic(): Promise<void> {
  await write('uz-cyrillic.xlsx', [
    ['Т/р', 'Номи', 'МХИК коди', 'Қадоқ коди', 'Ўлчов бирлиги', 'Штрих коди', 'Нарх (ҚҚС билан)', 'ҚҚС'],
    ['1', 'Сариёғ Lactel 200 г', REAL.butter200.code, REAL.butter200.consumerPack, 'дона', REAL.butter200.gtin, '28 500', 'ҚҚС 12%'],
    ['2', 'Сариёғ (тарозида)', REAL.butterBase.code, REAL.butter200.box40, 'кг', '', '96 000', '12'],
    ['3', 'Мушук учун озуқа', REAL.petFoodBase.code, REAL.petFoodBase.kgPackage, 'кг', '', '41 250,555', 'ҚҚСсиз'],
    ['4', 'Сариёғ Lactel 200 г', REAL.butter200.code, REAL.butter200.consumerPack, 'дона', REAL.butter200.gtin, '28 500', '12'],
  ], { text: [3, 4, 6] });
}

// (5) Uzum Market seller card (seller.uzum.uz/manual/5.product-creation): many columns, only a few are ours.
async function uzum(): Promise<void> {
  await write('uzum-seller.xlsx', [
    ['Категория', 'Наименование товара', 'Бренд', 'НДС', 'Описание', 'Краткое описание', 'SKU товара', 'Штрихкод', 'ИКПУ', 'Цена', 'Скидка', 'Цена продажи', 'Комиссия', 'К выводу', 'Ширина (мм)', 'Длина (мм)', 'Высота (мм)', 'Вес (г)'],
    ['Молочные продукты', 'Sariyogʻ / Масло сливочное Lactel 200 г', 'Lactel', '12%', 'Сливочное масло', 'Масло 200 г', 'LCT200', `${REAL.butter200.gtin};${REAL.butter400.gtin}`, REAL.butter200.code, '28500', '0', '28500', '2850', '25650', '95', '65', '30', '205'],
    ['Молочные продукты', 'Sariyogʻ / Масло сливочное весовое', 'Lactel', '12%', '', '', 'LCTKG', IN_STORE, REAL.butterBase.code, '96000', '0', '96000', '9600', '86400', '', '', '', '1000'],
    ['Красота', 'Antiseptik / Антисептик для рук 50 мл', 'ARN', '0%', '', '', 'ARN50', '4780083550025', REAL.antiseptic.code, '9990', '0', '9990', '999', '8991', '40', '40', '110', '60'],
    ['Молочные продукты', 'Sariyogʻ / Масло Lactel 200 г, набор', 'Lactel', '12%', '', '', 'LCT200B', REAL.butter200.gtin, REAL.sugar.code, '28500', '0', '28500', '2850', '25650', '', '', '', ''],
    ['Молочные продукты', 'Sariyogʻ / Масло сливочное', 'Lactel', '12%', '', '', 'LCTB', REAL.butter200.gtin, REAL.butterBase.code, '28500', '0', '28500', '2850', '25650', '', '', '', ''],
  ], { text: [7, 8, 9] });
}

// (6) Click fiscal item (docs.click.uz/en/fiscalization, pay-uz wire names): SPIC, PackageCode, GoodPrice in tiyin.
async function clickFiscal(): Promise<void> {
  await write('click-fiscal.xlsx', [
    ['Name', 'SPIC', 'PackageCode', 'GoodPrice', 'Price', 'Amount', 'VAT', 'VATPercent', 'Units'],
    ['Масло сливочное Lactel 200 г', REAL.butter200.code, REAL.butter200.consumerPack, 2850000, 2850000, 1, 305357, 12, 'шт'],
    ['Международная перевозка', REAL.transport.code, '', 150000000, 150000000, 1, 0, 0, 'кг'],
    ['Масло сливочное весовое', REAL.butterBase.code, REAL.butterBase.kgPackage, 9600000, 4800000, 0.5, 514286, 12, 'кг'],
  ], { text: [2, 3] });
}

// (7) magicstore.ai ИКПУ import as CSV saved by Excel (magicstore.ai/ru/docs/catalog/ikpu): the codes Excel turned into numbers.
function magicstoreCsv(): void {
  const lines = [
    ['ID', 'Название', 'ИКПУ', 'Код упаковки'],
    ['101', 'Масло Lactel 200 г', '4,05001E+14', REAL.butter200.consumerPack],
    ['102', 'Масло весовое', '405001001000000', REAL.butterBase.kgPackage],
    ['103', 'Антисептик 50 мл', REAL.antiseptic.code, ''],
    ['104', 'Корм для кошек', '2.30900100100000E+15', ''],
  ];
  writeFileSync(join(DIR, 'magicstore-ikpu.csv'), `${lines.map((l) => l.join(';')).join('\r\n')}\r\n`, 'utf8');
}

await moysklad();
await onecList();
await bulineLatin();
await uzCyrillic();
await uzum();
await clickFiscal();
magicstoreCsv();
console.log('product fixtures written to', DIR);

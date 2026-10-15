// The landing page's sample catalogue: an invented minimarket export, written
// the way a shop's 1C / МойСклад export actually looks — Russian headers,
// names in Russian, Uzbek and transliteration, pack sizes glued on, mixed
// units. It is the single source for public/demo/namuna-katalog.xlsx and for
// the frozen sample report, so the file a visitor downloads is exactly the
// file the landing page's numbers came from.
//
// What is invented: the shop, the product NAMES as typed, and the prices.
// What is not: every barcode and every "shop" code below was taken from the
// classifier itself (codes from the 15.10.2026 export). Some codes are wrong
// on purpose — the mistakes shops really make — and the comment says which
// mistake. Whether the audit flags a row, and what it suggests, is decided
// only by the pipeline (scripts/make-sample-report.ts), never written here.
import ExcelJS from 'exceljs';

export const SAMPLE_FILENAME = 'namuna-katalog.xlsx';

/** Header row as a 1C export writes it. The importer maps these automatically. */
export const SAMPLE_HEADERS = ['Наименование', 'Штрих-код', 'ИКПУ', 'Ед. изм.', 'Цена'] as const;

/** Column index of each field in SAMPLE_HEADERS, as the importer's mapping. */
export const SAMPLE_MAPPING = { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4 } as const;

type Row = readonly [name: string, barcode: string, mxik: string, unit: string, price: string];

export const SAMPLE_ROWS: readonly Row[] = [
  ['Кока-Кола 1,5л пэт', '4780069000154', '02202002001010009', 'шт', '12000'],
  // Copied from the row above: a water carrying the cola's code.
  ['Hydrolife 0,5L gazsiz', '4780012960153', '02202002001010009', 'шт', '2500'],
  ['Hydrolife 1,5л негаз.', '4780012960092', '02201001001011006', 'шт', '4000'],
  // Typed by hand, one digit short.
  ['Coca-Cola 0,33 ж/б', '5449000000996', '0220200200101002', 'шт', '7000'],
  ['Pepsi Cherry 1,5л', '4780022621198', '02202002001039008', 'шт', '11000'],
  // New item, code never filled in.
  ['Pepsi Lime 1.5 L', '', '', 'шт', '11000'],
  ['Молоко Nestle Sutim 3,2% 1л', '4780100650478', '00401001001006003', 'шт', '14500'],
  // Right code, but the unit was entered as litres; the code is bound to "dona".
  ['Sut Nestle 1L paket', '4780018010067', '00401001001004002', 'л', '12500'],
  // Copied from the milk row: kefir carrying the milk code.
  ['Кефир Alsafi 1% 1л', '4780030101613', '00401001001006003', 'шт', '13000'],
  // New item, code never filled in.
  ['Кефир Bio-Sut 1% 0,5л', '4780065300265', '', 'шт', '7500'],
  ['Яйцо кур. ASL С2 10шт', '4780090810012', '00407001001001002', 'шт', '16000'],
  ['Масло подсолн. Олейна раф. 1л', '4607083550482', '01512001001103001', 'шт', '24000'],
  // A code that does not exist: the last digits were mistyped.
  ['Масло Олейна 3л', '4607083550505', '01512001001103020', 'шт', '68000'],
  ['Мука Makfa в/с 5кг', '4601780017835', '01101001001081001', 'шт', '42000'],
  ['Рис Мистраль Басмати 500г', '4601916001677', '01006001003001003', 'шт', '21000'],
  // Packaged rice bound to "dona", entered in grams.
  ['Guruch Mistral Akvatika 500 gr', '4601916000434', '01006001003001002', 'гр', '19000'],
  ['Сахар Мистраль тростн. 900г', '4601916006238', '01701001001001003', 'шт', '26000'],
  // Packaged sugar bound to "dona", entered in kilograms.
  ['Shakar Mistral qamish 500g quti', '4601916002308', '01701001001001001', 'кг', '17000'],
  ['Kartoshka', '', '00701001001000000', 'кг', '6000'],
  ['Шоколад Alpen Gold фундук/изюм 85г', '7622201448707', '01806001008001012', 'шт', '11000'],
  ['Snickers Super 95g', '4011100977716', '01806001001001001', 'шт', '9000'],
  // Excel turned the code into a number and ate the leading zero.
  ['Snickers minis 180г', '4607065000073', '1806001001001007', 'шт', '32000'],
  ['Colgate Max White 100мл', '6920354805851', '03306001001032004', 'шт', '18000'],
  // Copied from the toothpaste row: washing capsules carrying its code.
  ['Ariel kapsula 3in1 12 dona', '4015600949709', '03306001001032004', 'шт', '65000'],
  ['Ariel порошок 450г Горный родник', '5413149032224', '03402003001252002', 'шт', '16000'],
  ['Pampers 4 (9-14кг) 34шт', '0780102022730', '09619002001006001', 'шт', '135000'],
  ['Duracell AA LR6 4шт', '5000394052536', '08506001001004004', 'шт', '28000'],
];

/** Rows as an .xlsx buffer, codes stored as text so Excel keeps all 17 digits. */
export async function sampleWorkbook(rows: readonly (readonly string[])[] = SAMPLE_ROWS): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'MXIK Audit — namuna';
  const sheet = workbook.addWorksheet('Katalog');
  sheet.addRow([...SAMPLE_HEADERS]);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow([...row]);
  for (const col of [SAMPLE_MAPPING.barcode + 1, SAMPLE_MAPPING.mxik + 1]) {
    sheet.getColumn(col).numFmt = '@';
    sheet.getColumn(col).width = 20;
  }
  sheet.getColumn(SAMPLE_MAPPING.name + 1).width = 38;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

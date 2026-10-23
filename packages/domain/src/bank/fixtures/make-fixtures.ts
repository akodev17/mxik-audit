// Writes the bank statement fixtures the parser tests read:
//
//   npx tsx packages/domain/src/bank/fixtures/make-fixtures.ts
//
// SYNTHETIC FILES. No real statement was available (tmp/found-catalogs holds product catalogues
// only); these follow the layouts described in docs/accounting-2026-10-23/integration-research.md
// §2 — title rows above the header, balance rows without a date, a totals row, an ИНН of zeros,
// acquiring rows without a counterparty, bank fees — with an invented bank ("Namuna Bank", namuna =
// sample) and invented companies, accounts and ИНН. Totals and balances are computed here exactly,
// so a clean fixture reconciles to the tiyin. Replace or extend with the owner's real exports.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const DIR = dirname(fileURLToPath(import.meta.url));

/** Amount in tiyin → "1 234 567,89" (the way RU/UZ banks print text amounts). */
const ruAmount = (tiyin: bigint): string => {
  const whole = (tiyin / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole},${(tiyin % 100n).toString().padStart(2, '0')}`;
};
/** Excel serial of a calendar date (1900 system). */
const serial = (iso: string): number => Math.round((Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - Date.UTC(1899, 11, 30)) / 86_400_000);

const OWN = { name: 'ООО «Тасниво Тест»', inn: '301234567', account: '20208000900123456001', accountSpaced: '20208 000 9 00123456 001' };

// ── (a) RU, two-row header (Корреспондент and Сумма split into sub-columns), reconciles ─────

async function ruDebitCredit(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Выписка');
  const opening = 1_500_000_000n; // 15 000 000,00
  type Line = { date: string; doc: string; name: string; inn: string; account: string; mfo: string; debit?: bigint; credit?: bigint; purpose: string; numeric?: boolean; wrap?: string };
  const lines: Line[] = [
    { date: '01.10.2026', doc: '15', name: 'ООО «Альфа Трейд»', inn: '302345678', account: '20208000500111222001', mfo: '00440', credit: 1_250_000_000n, purpose: 'Оплата за товар по договору № 4/28 от 01.01.2026г, в т.ч. НДС 12%' },
    { date: '02.10.2026', doc: '16', name: 'ИП Каримов Алишер', inn: '31203851234567', account: '20218000100222333002', mfo: '01024', debit: 123_456_789n, purpose: 'Оплата за услуги по счету №45 от 30.09.2026, без НДС' },
    { date: '03.10.2026', doc: '1', name: '', inn: '000000000', account: '', mfo: '', debit: 4_500_000n, purpose: 'Комиссия за обслуживание счета за сентябрь 2026' },
    { date: '05.10.2026', doc: '', name: '', inn: '000000000', account: '', mfo: '', credit: 345_000_000n, purpose: 'SmartVista - Выручка по терминалу 12345678 за 04.10.2026' },
    { date: '06.10.2026', doc: '17', name: 'Казначейство (бюджет)', inn: '', account: '23402000300100001010', mfo: '00014', debit: 210_000_000n, purpose: 'Уплата НДС за сентябрь 2026 года' },
    { date: '07.10.2026', doc: '18', name: 'АКБ «Намуна Банк» (зарплатный проект)', inn: '200111222', account: '22618000000000000099', mfo: '00440', debit: 840_000_000n, purpose: 'Перечисление заработной платы за сентябрь 2026 по реестру №9' },
    { date: '08.10.2026', doc: '19', name: 'ООО «Строй Материал»', inn: '303456789', account: '20208000700333444003', mfo: '00873', debit: 98_765_400n, purpose: 'Оплата по счету-фактуре №112 от 05.10.2026', wrap: 'за строительные материалы' },
    { date: '12.10.2026', doc: '20', name: 'ООО «Альфа Трейд»', inn: '302345678', account: '20208000500111222001', mfo: '00440', credit: 123_456_789n, purpose: 'Оплата за товар по договору № 4/28 от 01.01.2026г', numeric: true },
    { date: '15.10.2026', doc: '21', name: OWN.name, inn: OWN.inn, account: '20214840900123456002', mfo: '00440', credit: 500_000_000n, purpose: 'Перевод собственных средств с валютного счета' },
    { date: '20.10.2026', doc: '2', name: '', inn: '000000000', account: '', mfo: '', debit: 1_200_000n, purpose: 'погашение Дебетовый оборот (услуги банка)' },
  ];
  ws.addRow(['АКБ «Намуна Банк» (образец)']);
  ws.addRow(['ВЫПИСКА ЛИЦЕВОГО СЧЕТА за период с 01.10.2026 по 31.10.2026']);
  ws.addRow([`Клиент: ${OWN.name}`]);
  ws.addRow([`ИНН: ${OWN.inn}`]);
  ws.addRow([`Счет: ${OWN.accountSpaced}`]);
  ws.addRow(['Валюта: UZS (сум)']);
  ws.addRow([`Входящий остаток: ${ruAmount(opening)}`]);
  ws.addRow([]);
  const header = ws.addRow(['Дата', '№ док.', 'Корреспондент', '', '', '', 'Сумма', '', 'Назначение платежа']);
  ws.addRow(['', '', 'Наименование', 'ИНН', 'Счет', 'МФО', 'Дебет', 'Кредит', '']);
  ws.mergeCells(header.number, 3, header.number, 6);
  ws.mergeCells(header.number, 7, header.number, 8);
  ws.mergeCells(header.number, 1, header.number + 1, 1);
  ws.mergeCells(header.number, 2, header.number + 1, 2);
  ws.mergeCells(header.number, 9, header.number + 1, 9);
  ws.addRow([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  let debit = 0n;
  let credit = 0n;
  for (const l of lines) {
    debit += l.debit ?? 0n;
    credit += l.credit ?? 0n;
    const amount = (v: bigint | undefined): string | number => (v === undefined ? '0,00' : l.numeric ? Number(v) / 100 : ruAmount(v));
    ws.addRow([l.date, l.doc, l.name, l.inn, l.account, l.mfo, amount(l.debit), amount(l.credit), l.purpose]);
    if (l.wrap) ws.addRow(['', '', '', '', '', '', '', '', l.wrap]);
  }
  ws.addRow(['Итого обороты:', '', '', '', '', '', ruAmount(debit), ruAmount(credit), '']);
  ws.addRow(['Исходящий остаток:', '', '', '', '', '', '', ruAmount(opening + credit - debit), '']);
  ws.addRow([]);
  ws.addRow(['Главный бухгалтер ____________']);
  for (const col of [4, 5, 6]) ws.getColumn(col).numFmt = '@';
  await wb.xlsx.writeFile(join(DIR, 'ru-debit-credit.xlsx'));
}

// ── (b) UZ Latin, one header row, Excel serial dates and number cells, with broken rows ────

async function uzDebitCredit(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Ko'chirma");
  ws.addRow(['"NAMUNA BANK" ATB (namuna)']);
  ws.addRow(["Hisob raqami bo'yicha ko'chirma: 01.10.2026 - 31.10.2026"]);
  ws.addRow([`Mijoz: "TASNIVO TEST" MChJ, STIR ${OWN.inn}`]);
  ws.addRow([`Hisob raqami: ${OWN.account}`]);
  ws.addRow(["Valyuta: so'm"]);
  ws.addRow(['Sana', 'Hujjat raqami', 'Kontragent', 'STIR', 'Hisob raqami', 'MFO', 'Debet', 'Kredit', "To'lov maqsadi"]);
  ws.addRow(['', '', "Kirish qoldig'i", '', '', '', '', 7_250_000.5, '']);
  type Row = (string | number)[];
  const rows: Row[] = [
    [serial('2026-10-01'), '101', '"OMAD SAVDO" MChJ', '304567891', '20208000400555666004', '00491', 0, 2_500_000, "Shartnoma № 7 dan 01.09.2026 bo'yicha tovar uchun to'lov"],
    [serial('2026-10-02'), '102', '"BARAKA SERVIS" XK', '305678912', '20208000200666777005', '01101', 1_234_567.89, 0, "Xizmatlar uchun to'lov, QQS bilan"],
    ['03.10.2026', '1', '', '000000000', '', '', 35_000, 0, "Bank xizmat haqi (komissiya) sentyabr 2026"],
    [serial('2026-10-05'), '103', "Xodimlar (ish haqi loyihasi)", '', '22618000000000000099', '00440', 4_000_000, 0, "Oylik ish haqi sentyabr 2026"],
    [serial('2026-10-06'), '', '', '000000000', '', '', 0, 980_000, 'SmartVista - Выручка по терминалу 87654321'],
    ['32.10.2026', '104', '"OMAD SAVDO" MChJ', '304567891', '20208000400555666004', '00491', 0, 100_000, "Tovar uchun to'lov"],
    [serial('2026-10-08'), '105', '"QURILISH" MChJ', '12345', '2020800010', '491', 500_000, 0, "Qurilish materiallari uchun"],
    [serial('2026-10-09'), '106', '"OMAD SAVDO" MChJ', '304567891', '20208000400555666004', '00491', 200_000, 300_000, "Qaytarish"],
    [serial('2026-10-10'), '107', '"OMAD SAVDO" MChJ', '304567891', '20208000400555666004', '00491', 0, '1,2,3', "Tovar uchun to'lov"],
    ['', '108', '"BARAKA SERVIS" XK', '305678912', '20208000200666777005', '01101', 75_000, 0, ''],
  ];
  for (const r of rows) ws.addRow(r);
  ws.addRow(['', '', 'Kunlik aylanma', '', '', '', '', '', '']);
  // The bank's totals over every row with a readable amount (the rows with two amounts or a garbled
  // one are corruption tests of ours; a bank would not print them).
  ws.addRow(['Jami', '', '', '', '', '', 5_844_567.89, 3_580_000, '']);
  ws.addRow(['', '', "Chiqish qoldig'i", '', '', '', '', 4_985_432.61, '']);
  ws.addRow(['Sahifa 1 / 1']);
  for (const col of [2, 4, 5, 6]) ws.getColumn(col).numFmt = '@';
  await wb.xlsx.writeFile(join(DIR, 'uz-debit-credit.xlsx'));
}

// ── (c) One amount + Дебет/Кредит flag, dates with time, reference, page break, reconciles ──

async function amountDirection(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  const opening = 50_000_000n; // 500 000,00
  const header = ['Дата операции', 'Номер документа', 'Наименование плательщика/получателя', 'ИНН', 'Расчётный счёт', 'МФО', 'Сумма', 'Дебет/Кредит', 'Назначение платежа', 'Референс', 'Валюта'];
  type Line = [string, string, string, string, string, string, bigint, string, string, string];
  const lines: Line[] = [
    ['01.10.2026 09:15:00', '501', 'ООО «Бета Логистик»', '306789123', '20208000600777888006', '00873', 1_000_000_00n, 'К', 'Оплата за перевозку по договору 12/2026', 'TRX-0001'],
    ['01.10.2026 11:40:12', '502', 'ООО «Гамма Офис»', '307891234', '20208000100888999007', '00440', 12_345_67n, 'Д', 'Оплата за канцтовары, счет 77', 'TRX-0002'],
    ['02.10.2026 10:00:00', '', '', '000000000', '', '', 2_500_00n, 'Д', 'Комиссия банка за перевод', 'TRX-0003'],
    ['03.10.2026 16:30:00', '', '', '000000000', '', '', 456_789_12n, 'К', 'Эквайринг: зачисление по POS-терминалу 556677', 'TRX-0004'],
    ['04.10.2026 12:00:00', '503', 'ООО «Гамма Офис»', '307891234', '20208000100888999007', '00440', 12_345_67n, 'Д', 'Оплата за канцтовары, счет 77', 'TRX-0002'],
    ['05.10.2026 09:00:00', '504', 'ООО «Дельта»', '308912345', '20208000300999000008', '00440', 7_000_00n, 'X', 'Неизвестная операция', 'TRX-0005'],
  ];
  ws.addRow(['Выписка по счету 20208000900123456001 (Намуна Банк, образец)']);
  ws.addRow(['Период: 01.10.2026 — 05.10.2026']);
  ws.addRow([`Остаток на начало периода: ${ruAmount(opening)}`]);
  ws.addRow(header);
  let balance = opening;
  lines.forEach((l, i) => {
    if (i === 3) {
      ws.addRow(['Страница 1 из 2']);
      ws.addRow(header);
    }
    const [date, doc, name, inn, account, mfo, amount, flag, purpose, ref] = l;
    if (flag === 'К') balance += amount;
    if (flag === 'Д') balance -= amount;
    ws.addRow([date, doc, name, inn, account, mfo, ruAmount(amount), flag, purpose, ref, 'UZS']);
  });
  ws.addRow(['Остаток на конец периода:', '', '', '', '', '', ruAmount(balance)]);
  ws.addRow(['Страница 2 из 2']);
  for (const col of [2, 4, 5, 6]) ws.getColumn(col).numFmt = '@';
  await wb.xlsx.writeFile(join(DIR, 'amount-direction.xlsx'));
}

// ── (c') Signed amounts in a windows-1251 CSV with ';' (Excel "save as CSV" in a RU locale) ─

function signedCsv(): void {
  const rows = [
    'Выписка по счету 20208000900123456001;;;;;',
    'Дата;Номер документа;Контрагент;ИНН;Сумма;Назначение платежа',
    '01.10.2026;601;ООО «Альфа Трейд»;302345678;2 000 000,00;Оплата за товар',
    '02.10.2026;602;ООО «Строй Материал»;303456789;-750 000,50;Оплата по счету 15',
    '03.10.2026;;;;-12 000,00;Комиссия за обслуживание счета',
    'Итого;;;;1 237 999,50;',
  ];
  const text = `${rows.join('\r\n')}\r\n`;
  const bytes = Buffer.from(Array.from(text, (ch) => cp1251(ch)));
  writeFileSync(join(DIR, 'signed-1251.csv'), bytes);
}

/** One character → its windows-1251 byte (the letters and signs this file uses). */
function cp1251(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code < 0x80) return code;
  if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
  if (code === 0x401) return 0xa8;
  if (code === 0x451) return 0xb8;
  if (ch === '«') return 0xab;
  if (ch === '»') return 0xbb;
  if (ch === '№') return 0xb9;
  throw new Error(`no windows-1251 byte for ${ch}`);
}

await ruDebitCredit();
await uzDebitCredit();
await amountDirection();
signedCsv();
console.log('bank fixtures written to', DIR);

// Writes the statement fixtures built from DOCUMENTED layouts (30 Oct 2026 research; every source
// with its URL in SOURCES.md):
//
//   npx tsx packages/domain/src/bank/fixtures/make-real-layouts.ts
//
// No Uzbek bank publishes a statement file, so the layouts come from what is published: the CBU
// Instruction п.121 list of a лицевой счёт's requisites (p121-two-row-header.xlsx), the Colvir
// manual's statement screen (colvir-statement.xls, a legacy BIFF8 file), the ASBT help on its
// document export (asbt-documents-pipe.zip: '|' text in a zip with the date in the file name;
// asbt-documents-fixed.txt: fixed width, fields touching), and the iBank2 guide's statement CSV
// (ibank2-all-accounts.csv: one file for two accounts, its two published example rows kept).
// Companies, accounts and amounts besides the published ones are invented; balances and totals are
// computed here, so each file reconciles to the tiyin unless a test says otherwise.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import JSZip from 'jszip';
import { foldForCp1251 } from '../../onec/bank-exchange.js';
import { biff8 } from './biff8.js';

const DIR = dirname(fileURLToPath(import.meta.url));

const ruAmount = (tiyin: bigint): string => {
  const whole = (tiyin / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${whole},${(tiyin % 100n).toString().padStart(2, '0')}`;
};
const dotAmount = (tiyin: bigint): string => `${tiyin / 100n}.${(tiyin % 100n).toString().padStart(2, '0')}`;
/** "1 234.00 UZS", the way the Colvir screen prints money. */
const colvirAmount = (tiyin: bigint): string => `${ruAmount(tiyin).replace(',', '.')} UZS`;

const OWN = { name: 'ООО «Тасниво Тест»', inn: '301234567', account: '20208000900123456001', mfo: '00444' };

// ── (a) CBU п.121 statement: title block, two-row merged header, page break, totals ─────────────

type P121Row = { posted: string; date: string | Date; no: string | number; kind: string; mfo: string | number; account: string; name: string; inn: string; debit: bigint; credit: bigint; code: string | number; purpose: string };

async function p121(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Кўчирма');
  const opening = 50_000_000_00n;
  ws.addRow(['Шахсий ҳисобварақдан кўчирма / Выписка из лицевого счёта № 0412']);
  ws.addRow(['Банк: АИКБ «Ипак Йули», Тошкент ш. (МФО 00444)']);
  ws.addRow([`Лицевой счёт: 20208 000 9 00123456 001 ${OWN.name}`]);
  ws.addRow([`ИНН: ${OWN.inn}`]);
  ws.addRow(['Период: с 01.10.2026 по 31.10.2026', '', '', '', 'Дата обработки: 31.10.2026', '', '', 'Дата последнего движения: 30.10.2026']);
  ws.addRow([`Входящий остаток: ${ruAmount(opening)}`]);
  ws.addRow([]);
  const top = ['№ п/п', 'Дата проводки', 'Дата документа', '№ документа', 'Вид документа', 'Корреспондент', '', '', '', 'Обороты', '', 'Код назначения', 'Назначение платежа'];
  const sub = ['', '', '', '', '', 'МФО', 'Счет', 'Наименование', 'ИНН', 'Дебет', 'Кредит', '', ''];
  const header = (): void => {
    const t = ws.addRow(top);
    const s = ws.addRow(sub);
    // Merged as Excel shows them: the top label spans its sub-columns; the reader sees it in the first cell only.
    ws.mergeCells(t.number, 6, t.number, 9);
    ws.mergeCells(t.number, 10, t.number, 11);
    for (const c of [1, 2, 3, 4, 5, 12, 13]) ws.mergeCells(t.number, c, s.number, c);
  };
  header();
  ws.addRow(top.map((_, i) => String(i + 1)));

  const rows: P121Row[] = [
    { posted: '01.10.2026', date: '30.09.2026', no: '00012', kind: '01', mfo: 444, account: '20208000400987654001', name: 'OOO «Qurilish Savdo»', inn: '302345678', debit: 0n, credit: 12_500_000_00n, code: '00664', purpose: 'Договор 4/28 от 01.01.2026г, оплата за консультационные услуги, в т.ч. НДС 12%' },
    { posted: '02.10.2026', date: new Date(Date.UTC(2026, 9, 2)), no: 12, kind: '01', mfo: '01176', account: '20208000100555444001', name: 'MChJ «Toshkent Logistika»', inn: '303456789', debit: 3_400_000_00n, credit: 0n, code: 668, purpose: 'Оплата за транспортные услуги по счету-фактуре № 77' },
    { posted: '02.10.2026', date: '02.10.2026', no: '113', kind: '06', mfo: '00444', account: '29801000900000000444', name: 'АИКБ «Ипак Йули»', inn: '', debit: 45_000_00n, credit: 0n, code: '', purpose: '00667 Комиссия банка за расчетно-кассовое обслуживание' },
    { posted: '03.10.2026', date: '03.10.2026', no: '41', kind: '01', mfo: '00014', account: '23402000300100001010', name: 'Давлат солиқ қўмитаси', inn: '200000000', debit: 1_200_000_00n, credit: 0n, code: '00102', purpose: 'Уплата НДС за сентябрь 2026 года' },
  ];
  const after = [
    { posted: '05.10.2026', date: '05.10.2026', no: '9', kind: '01', mfo: '00873', account: '20208000700111222001', name: 'XK «Samarqand Non»', inn: '304567890', debit: 0n, credit: 2_750_000_00n, code: '00664', purpose: 'Оплата по договору поставки' },
    { posted: '06.10.2026', date: '06.10.2026', no: '14', kind: '01', mfo: '00444', account: '20208000400987654001', name: 'OOO «Qurilish Savdo»', inn: '302345678', debit: 0n, credit: 1_000_000_00n, code: '00664', purpose: 'Доплата по договору 4/28' },
  ] satisfies P121Row[];
  let debit = 0n;
  let credit = 0n;
  const put = (r: P121Row, i: number): void => {
    debit += r.debit;
    credit += r.credit;
    const row = ws.addRow([String(i), r.posted, r.date, r.no, r.kind, r.mfo, r.account, r.name, r.inn, r.debit ? ruAmount(r.debit) : '0,00', r.credit ? ruAmount(r.credit) : '0,00', r.code, r.purpose]);
    if (r.date instanceof Date) row.getCell(3).numFmt = 'dd.mm.yyyy';
  };
  rows.forEach((r, i) => put(r, i + 1));
  // The purpose of the last row wraps onto a row of its own.
  ws.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '(налог на добавленную стоимость)']);
  // A printed page ends: its subtotal, the page footer, the header again.
  ws.addRow(['Итого по странице', '', '', '', '', '', '', '', '', ruAmount(debit), ruAmount(credit), '', '']);
  ws.addRow(['Страница 1 из 2']);
  header();
  after.forEach((r, i) => put(r, rows.length + i + 1));
  ws.addRow(['Итого обороты', '', '', '', '', '', '', '', '', ruAmount(debit), ruAmount(credit), '', '']);
  ws.addRow([`Исходящий остаток: ${ruAmount(opening + credit - debit)}`]);
  ws.addRow(['Главный бухгалтер ____________']);
  for (const c of [4, 6, 7, 9, 12]) ws.getColumn(c).numFmt = '@';
  // Excel turned these back into numbers, as it does: the doc number 12 and the МФО 444 lose their zeros (§7.35–36).
  writeFileSync(join(DIR, 'p121-two-row-header.xlsx'), Buffer.from(await wb.xlsx.writeBuffer()));
}

// ── (b) Colvir statement screen as a legacy .xls (BIFF8 in an OLE compound file) ───────────────


function colvir(): void {
  // The two payments, balances and totals of the manual's Рис. 26, then invented ones of the same shape.
  const rows: (string | number | null)[][] = [
    ['Выписка по счёту 20208000700000568005'],
    ['Доступные средства Эквивалент', null, 'Остаток Эквивалент', null, 'Входящий остаток Эквивалент', null, 'Исходящий остаток Эквивалент'],
    ['__AVAILABLE__', null, '__BALANCE__', null, '6 423.00 UZS', null, '__CLOSING__'],
    ['Дата валютирования: 16.06.2021 - 16.07.2021'],
    ['Дата создания', 'Дата валютирования', 'Номер документа', 'Корреспондент', 'Счет', 'БИК', 'Банк', 'Создан в ИБ', 'Расход', 'Приход'],
  ];
  const opening = 6_423_00n;
  let out = 0n;
  let inn = 0n;
  const pay = (created: string, value: string, no: number, name: string, account: string, mfo: number, bank: string, ib: string, debit: bigint, credit: bigint, purpose: string): void => {
    out += debit;
    inn += credit;
    rows.push([created, value, no, name, account, mfo, bank, ib, debit ? colvirAmount(debit) : null, credit ? colvirAmount(credit) : null]);
    rows.push([purpose]);
  };
  pay('05.07.2021', '05.07.2021', 548108, 'Aksiyadorlik…', '19997000900000000401', 401, 'ТОШКЕНТ Ш.…', 'Нет', 1_234_00n, 0n, 'Исполнение платежного документа номер 548108');
  pay('18.06.2021', '18.06.2021', 128, 'ОАО РусМо…', '20208000500000000128', 401, 'ТОШКЕНТ Ш.…', 'Да', 500_00n, 0n, 'Исполнение платежного документа номер 54810');
  // Enough invented rows that the shared strings run past one record (CONTINUE).
  for (let i = 0; i < 70; i++) {
    const credit = i % 2 === 0 ? BigInt(10_000_00 + i * 1_37) : 0n;
    const debit = i % 2 === 1 ? BigInt(2_000_00 + i * 11) : 0n;
    pay(`${String((i % 28) + 1).padStart(2, '0')}.07.2021`, `${String((i % 28) + 1).padStart(2, '0')}.07.2021`, 600_000 + i, `МЧЖ «Ҳамкор Савдо ${i}»`, `2020800050${String(i).padStart(10, '0')}`, 873, 'АТБ «Ҳамкорбанк»', 'Да', debit, credit, `Оплата по договору № ${100 + i} от 01.07.2021 за товары, в т.ч. НДС 15% — партия ${i}`);
  }
  // The screen prints every turnover in the last (Приход) column, page subtotals first.
  rows.push(['Обороты по расходу на странице:', null, null, null, null, null, null, null, null, colvirAmount(out)]);
  rows.push(['Обороты по приходу на странице:', null, null, null, null, null, null, null, null, colvirAmount(inn)]);
  rows.push(['Обороты по расходу:', null, null, null, null, null, null, null, null, colvirAmount(out)]);
  rows.push(['Обороты по приходу:', null, null, null, null, null, null, null, null, colvirAmount(inn)]);
  const closing = colvirAmount(opening + inn - out);
  const balanceRow = rows[2] as (string | number | null)[];
  balanceRow[0] = closing;
  balanceRow[2] = closing;
  balanceRow[6] = closing;
  writeFileSync(join(DIR, 'colvir-statement.xls'), biff8('Выписка', rows));
}

// ── (c) ASBT «Экспорт документов»: payer/payee fields, '|' in a zip, and fixed width ────────────

type Doc = { no: string; date: string; payerAccount: string; payerInn: string; payerName: string; payerMfo: string; payeeAccount: string; payeeInn: string; payeeName: string; payeeMfo: string; amount: bigint; code: string; purpose: string };

const ASBT_DOCS: Doc[] = [
  { no: '1', date: '30.10.2026', payerAccount: OWN.account, payerInn: OWN.inn, payerName: OWN.name, payerMfo: OWN.mfo, payeeAccount: '20208000400987654001', payeeInn: '302345678', payeeName: 'OOO «Qurilish Savdo»', payeeMfo: '00444', amount: 7_800_000_00n, code: '00664', purpose: 'Оплата по договору 4/28 от 01.01.2026 за услуги' },
  { no: '1', date: '30.10.2026', payerAccount: '20208000100555444001', payerInn: '303456789', payerName: 'MChJ «Toshkent Logistika»', payerMfo: '01176', payeeAccount: OWN.account, payeeInn: OWN.inn, payeeName: OWN.name, payeeMfo: OWN.mfo, amount: 15_000_000_00n, code: '00664', purpose: 'Оплата за товар по счету-фактуре № 91' },
  { no: '2', date: '30.10.2026', payerAccount: OWN.account, payerInn: OWN.inn, payerName: OWN.name, payerMfo: OWN.mfo, payeeAccount: '23402000300100001010', payeeInn: '200000000', payeeName: 'Давлат солиқ қўмитаси', payeeMfo: '00014', amount: 2_340_000_00n, code: '00102', purpose: 'Уплата НДС за сентябрь 2026 года' },
  { no: '17', date: '30.10.2026', payerAccount: '20208000700111222001', payerInn: '304567890', payerName: 'XK «Samarqand Non»', payerMfo: '00873', payeeAccount: OWN.account, payeeInn: OWN.inn, payeeName: OWN.name, payeeMfo: OWN.mfo, amount: 980_500_50n, code: '00664', purpose: 'Предоплата за поставку' },
];

const FIELDS: [string, number, (d: Doc) => string, 'left' | 'right'][] = [
  ['Номер документа', 16, (d) => d.no, 'left'],
  ['Дата документа', 15, (d) => d.date, 'left'],
  ['Счет плательщика', 20, (d) => d.payerAccount, 'left'],
  ['ИНН плательщика', 15, (d) => d.payerInn, 'left'],
  ['Наименование плательщика', 30, (d) => d.payerName, 'left'],
  ['МФО плательщика', 15, (d) => d.payerMfo, 'left'],
  ['Счет получателя', 20, (d) => d.payeeAccount, 'left'],
  ['ИНН получателя', 15, (d) => d.payeeInn, 'left'],
  ['Наименование получателя', 30, (d) => d.payeeName, 'left'],
  ['МФО получателя', 15, (d) => d.payeeMfo, 'left'],
  ['Сумма', 16, (d) => dotAmount(d.amount), 'right'],
  ['Код назначения', 14, (d) => d.code, 'left'],
  ['Назначение платежа', 60, (d) => d.purpose, 'left'],
];

async function asbt(): Promise<void> {
  const delimited = [FIELDS.map(([h]) => h).join('|'), ...ASBT_DOCS.map((d) => FIELDS.map(([, , v]) => v(d)).join('|'))].join('\r\n') + '\r\n';
  const zip = new JSZip();
  // «Добавить дату к имени файла»: yyy.txt exported for 30.10.2026 is yyy301026.txt.
  zip.file('vypiska301026.txt', iconv.encode(foldForCp1251(delimited), 'win1251'));
  writeFileSync(join(DIR, 'asbt-documents-pipe.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const pad = (text: string, width: number, align: 'left' | 'right'): string => (align === 'right' ? text.padStart(width) : text.padEnd(width)).slice(0, width);
  const fixed = [
    FIELDS.map(([h, w]) => pad(h, w, 'left')).join(''),
    ...ASBT_DOCS.map((d) => FIELDS.map(([, w, v, a]) => pad(v(d), w, a)).join('')),
  ].join('\r\n') + '\r\n';
  writeFileSync(join(DIR, 'asbt-documents-fixed.txt'), iconv.encode(foldForCp1251(fixed), 'win1251'));
}

// ── (d) iBank2 statement CSV, «Экспортировать в один файл»: two accounts in one file ─────────────

function ibank2(): void {
  const header = 'Счет;Дата операции;Код операции;Бик банка;Кор. счет банка;Название банка;Счет корреспондента;Корреспондент;Номер документа;Дата документа;Дебет;Кредит;Код;Примечание;ИНН Корреспондента;Очередность платежа;Рез. поле;ID докум.';
  const lines = [
    header,
    // The guide's two example rows (p.132), unchanged: a Russian account, the quoted bank name, decimal commas.
    '40702810300180001774;24.04.2014;1;043207730;30101810700000000730;"КЕМЕРОВСКИЙ" ФИЛИАЛ ОАО БАНК ЗЕНИТ, г.КЕМЕРОВО;30101810700000000108;ОАО "Прогресс Парк";6;24.04.2014;;1256,13;;оплата услуг;951473628147;;;',
    '40702810300180001774;12.05.2014;1;044525219;30101810700000000730;ОАО "ОТП БАНК";50702810660000000300;ОАО "Кипарис";11;12.05.2014;;1260,00;;сервисный сбор;951473628147;;;',
    // A second account of the same client, Uzbek data in the same columns (posting date after the document date).
    `${OWN.account};01.10.2026;1;00444;;АИКБ «Ипак Йули»;20208000400987654001;OOO «Qurilish Savdo»;00012;30.09.2026;;12500000,00;00664;Оплата за консультационные услуги;302345678;;;A-1001`,
    `${OWN.account};02.10.2026;1;01176;;АТБ «Тенге Банк»;20208000100555444001;MChJ «Toshkent Logistika»;12;02.10.2026;3400000,00;;00668;Оплата за транспортные услуги;303456789;;;A-1002`,
    `${OWN.account};02.10.2026;1;00444;;АИКБ «Ипак Йули»;29801000900000000444;АИКБ «Ипак Йули»;113;02.10.2026;45000,00;;00667;Комиссия банка;;;;A-1003`,
  ];
  writeFileSync(join(DIR, 'ibank2-all-accounts.csv'), iconv.encode(lines.join('\r\n') + '\r\n', 'win1251'));
}

await p121();
colvir();
await asbt();
ibank2();
console.log('written to', DIR);

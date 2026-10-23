// Sample source data for the 1C layer's tests, the golden files and scripts/seed-accounting-demo.ts.
// Invented companies, accounts and ИНН (no real taxpayer); shapes follow packages/contracts/src/
// accounting.ts exactly, as the bank and Didox workstreams produce them. The statement balances:
// 12 500 000.00 + 30 870 000.00 − 15 425 500.00 = 27 944 500.00.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';

type BankTransaction = z.infer<typeof accounting.BankTransaction>;
type BankStatementMeta = z.infer<typeof accounting.BankStatementMeta>;
type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;
type CounterpartyRef = z.infer<typeof accounting.CounterpartyRef>;

export const OUR_ACCOUNT = '20208000900100001001';

export const BANK_META: BankStatementMeta = {
  formatId: 'fixture', bankName: 'АКБ «Намуна банк»', account: OUR_ACCOUNT, currency: 'UZS',
  periodFrom: '2026-10-01', periodTo: '2026-10-07',
  openingBalance: '12500000.00', closingBalance: '27944500.00', totalDebit: '15425500.00', totalCredit: '30870000.00',
  headers: ['Дата', '№ док', 'Корреспондент', 'ИНН', 'Счет', 'МФО', 'Дебет', 'Кредит', 'Назначение'],
  columnMap: { date: 0, docNumber: 1, name: 2, inn: 3, account: 4, mfo: 5, debit: 6, credit: 7, purpose: 8 },
  dropped: [], ownerName: 'ООО «Тасниво Тест»', ownerInn: '300000001', mfo: '00999',
};

const cp = (name: string, inn: string | null, account: string | null, mfo: string | null): CounterpartyRef =>
  ({ name, inn, account, mfo, counterpartyId: null });

const tx = (date: string, docNumber: string | null, direction: 'debit' | 'credit', amount: string, counterparty: CounterpartyRef, purpose: string): BankTransaction => ({
  date, docNumber, direction, amount, currency: 'UZS', ourAccount: OUR_ACCOUNT, counterparty, purpose,
  reference: null, valueDate: null, operation: direction === 'credit' ? 'payment_in' : 'payment_out', cashFlowItem: null, contract: null, decidedBy: null,
});

export const BANK_TRANSACTIONS: BankTransaction[] = [
  tx('2026-10-01', '101', 'credit', '15000000.00', cp('ООО "Ромашка Савдо"', '301234567', '20208000100200300401', '00444'), 'Оплата по договору №4/28 от 01.01.2026г за товары'),
  tx('2026-10-02', '57', 'debit', '3200000.00', cp('MChJ «Qurilish Gʻisht»', '302345678', '20208000200300400502', '00873'), 'Toʻlov: 12-sonli hisob-faktura boʻyicha gʻisht uchun'),
  tx('2026-10-03', '102', 'credit', '8750000.00', cp('ЧП Иванов', '303456789', '20208000300400500603', '00444'), 'Предоплата за поставку'),
  tx('2026-10-04', '58', 'debit', '12000000.00', cp('Toshkent shahar soliq boshqarmasi', '200935935', '23402000300100001010', '00014'), 'НДС за сентябрь 2026'),
  tx('2026-10-05', null, 'debit', '225500.00', cp('', null, null, null), 'Комиссия банка за обслуживание счёта'),
  tx('2026-10-06', '103', 'credit', '7120000.00', cp('ООО Ромашка Савдо', '301234567', '20208000100200300401', '00444'), 'Оплата по договору №4/28, счёт 15\nвторая строка назначения'),
];

export const INVOICE_META: IncomingInvoiceMeta = {
  source: 'didox_json', externalId: 'fixture-0001', number: 'ЭСФ-125', date: '2026-10-03', contractNumber: '4/28', contractDate: '2026-01-01',
  seller: cp('ООО "Ромашка Савдо"', '301234567', '20208000100200300401', '00444'),
  buyer: cp('ООО «Тасниво Тест»', '300000001', OUR_ACCOUNT, '00999'),
  currency: 'UZS', totalAmount: '1950000', totalVat: '234000', totalWithVat: '2184000', didoxStatus: 'signed', signed: true,
};

const noMatch = { status: 'new' as const, chosen: null, candidates: [] };

const line = (lineNo: number, name: string, mxik: string | null, packageCode: string | null, unit: string, quantity: string, price: string, amount: string): InvoiceLine => {
  const vat = (Number(amount) * 0.12).toFixed(2);
  return {
    lineNo, name, mxik, mxikName: null, packageCode, packageName: null, measureId: null, unit, barcode: null, quantity, price, amount,
    vatRate: '12', vatAmount: vat, total: (Number(amount) + Number(vat)).toFixed(2), product: noMatch, resolved: null,
  };
};

export const INVOICE_LINES: InvoiceLine[] = [
  line(1, 'Сахар-песок 50 кг', '01701001001000000', '1378325', 'мешок', '10', '45000', '450000'),
  line(2, 'Масло подсолнечное 1 л', '01512001001000000', '1378325', 'шт', '100', '9000', '900000'),
  line(3, 'Мука высший сорт 25 кг', '01101001001000000', '1378325', 'мешок', '20', '25000', '500000'),
  line(4, 'Доставка', null, null, 'услуга', '1', '100000', '100000'),
];

export const PRODUCTS: ProductRecord[] = [
  { productId: null, name: 'Сахар-песок 50 кг', onecRef: null, mxik: '01701001001000000', mxikName: null, packageCode: '1378325', packageName: 'шт.', unit: 'мешок', barcode: '4780000000017', aliases: [], mxikStatus: 'ok', mxikSuggestion: null, markingRequired: false },
  { productId: null, name: 'Масло подсолнечное 1 л', onecRef: null, mxik: '01512001001000000', mxikName: null, packageCode: '1378325', packageName: 'шт.', unit: 'шт', barcode: '0478000000024', aliases: [], mxikStatus: 'ok', mxikSuggestion: null, markingRequired: false },
  { productId: null, name: 'Мука высший сорт 25 кг', onecRef: null, mxik: null, mxikName: null, packageCode: null, packageName: null, unit: 'мешок', barcode: null, aliases: [], mxikStatus: 'missing', mxikSuggestion: null, markingRequired: null },
];

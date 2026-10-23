// The 1C files against golden files (packages/domain/src/onec/fixtures/), the bank-exchange round
// trip, and the pure helpers. No database. Regenerate the golden files after a deliberate format
// change with UPDATE_GOLDEN=1 and review the diff.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import { accounting } from '@tasnivo/contracts';
import {
  bankExchangeText, buildBankExchange, decodeBankExchange, exchangeDocumentOf, foldForCp1251, parseBankExchange,
} from './bank-exchange.js';
import { fromMicros, money2, toMicros } from './decimal.js';
import { buildFile, type FileSettings } from './files.js';
import { BANK_META, BANK_TRANSACTIONS, INVOICE_LINES, INVOICE_META, PRODUCTS } from './fixtures/demo-data.js';
import { bankFingerprint } from './fingerprint.js';
import { normalizeName } from './normalize.js';
import { planExport, type PlanBatch, type PlanRecord } from './plan.js';
import { build1cCsv, NOMENCLATURE_HEADERS, RECEIPT_LINE_HEADERS } from './sheets.js';

const FIXTURES = join(process.cwd(), 'packages', 'domain', 'src', 'onec', 'fixtures');
const NOW = new Date('2026-10-23T11:00:00Z');
const UPDATE = process.env['UPDATE_GOLDEN'] === '1';

function golden(name: string, actual: Buffer | string): void {
  const path = join(FIXTURES, name);
  const bytes = typeof actual === 'string' ? Buffer.from(actual, 'utf8') : actual;
  if (UPDATE || !existsSync(path)) writeFileSync(path, bytes);
  assert.deepEqual(bytes, readFileSync(path), `${name} differs from the golden file (UPDATE_GOLDEN=1 regenerates it)`);
}

const records = (payloads: readonly unknown[]): PlanRecord[] =>
  payloads.map((payload, i) => ({ id: `r${i}`, rowIndex: i, status: 'valid', payload, issues: [], fingerprint: `f${i}`, decision: null }));
const settings = (o: Partial<FileSettings> = {}): FileSettings => ({ bankKeys: 'standard', ownerName: 'ООО «Тасниво Тест»', filename: 'vypiska.xlsx', wholeStatement: true, now: NOW, ...o });
const none = { exportedElsewhere: new Map<string, { batchId: string }>() };

const bankBatch: PlanBatch = { id: 'b-bank', kind: 'bank_statement', meta: BANK_META };
const invoiceBatch: PlanBatch = { id: 'b-inv', kind: 'didox_invoice', meta: INVOICE_META };
const productBatch: PlanBatch = { id: 'b-prod', kind: 'product_catalog', meta: { source: 'xlsx', headers: [], columnMap: {}, catalogId: null } };

/** Every cell of every sheet as text, row by row (the golden form of an .xlsx: the zip's bytes carry timestamps). */
async function cells(bytes: Buffer): Promise<Record<string, string[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const out: Record<string, string[][]> = {};
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => {
      const values = (row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean)));
      rows.push(values);
    });
    out[ws.name] = rows;
  }
  return out;
}

async function xlsxGolden(name: string, bytes: Buffer): Promise<Record<string, string[][]>> {
  const grid = await cells(bytes);
  golden(name, `${JSON.stringify(grid, null, 1)}\n`);
  return grid;
}

describe('fixtures follow the shared contract', () => {
  it('every fixture record and header parses with its zod schema', () => {
    for (const t of BANK_TRANSACTIONS) accounting.BankTransaction.parse(t);
    for (const l of INVOICE_LINES) accounting.InvoiceLine.parse(l);
    for (const p of PRODUCTS) accounting.ProductRecord.parse(p);
    accounting.BankStatementMeta.parse(BANK_META);
    accounting.IncomingInvoiceMeta.parse(INVOICE_META);
  });
});

describe('bank_exchange_1_02 (1CClientBankExchange)', () => {
  const plan = planExport(bankBatch, records(BANK_TRANSACTIONS), 'bank_exchange_1_02', undefined, none);

  it('the standard file matches the golden file byte for byte (windows-1251, CRLF)', async () => {
    const file = await buildFile(bankBatch, plan, 'bank_exchange_1_02', settings());
    assert.equal(file.filename, 'kl_to_1c.txt');
    assert.equal(file.contentType, 'text/plain; charset=windows-1251');
    golden('bank_exchange_1_02.standard.kl_to_1c.txt', file.bytes);
    const text = decodeBankExchange(file.bytes);
    assert.match(text, /^1CClientBankExchange\r\nВерсияФормата=1\.02\r\nКодировка=Windows\r\n/);
    assert.ok(text.endsWith('КонецФайла\r\n'));
    assert.ok(!/МФО=/.test(text), 'the standard keys carry the МФО in БИК only');
    assert.equal((text.match(/^СекцияДокумент=Платежное поручение$/gm) ?? []).length, BANK_TRANSACTIONS.length);
  });

  it('uz_mfo also writes ПлательщикМФО / ПолучательМФО', async () => {
    const file = await buildFile(bankBatch, plan, 'bank_exchange_1_02', settings({ bankKeys: 'uz_mfo' }));
    golden('bank_exchange_1_02.uz_mfo.kl_to_1c.txt', file.bytes);
    const text = decodeBankExchange(file.bytes);
    assert.match(text, /\r\nПлательщикМФО=00444\r\n/);
    assert.match(text, /\r\nПолучательМФО=00999\r\n/);
    assert.match(text, /\r\nПлательщикБИК=00444\r\n/);
  });

  it('round trip: parseBankExchange gives back every transaction', async () => {
    const file = await buildFile(bankBatch, plan, 'bank_exchange_1_02', settings({ bankKeys: 'uz_mfo' }));
    const parsed = parseBankExchange(file.bytes);
    assert.equal(parsed.header['ВерсияФормата'], '1.02');
    assert.equal(parsed.header['РасчСчет'], BANK_META.account);
    assert.equal(parsed.accounts[0]?.['НачальныйОстаток'], '12500000.00');
    assert.equal(parsed.accounts[0]?.['КонечныйОстаток'], '27944500.00');
    assert.equal(parsed.documents.length, BANK_TRANSACTIONS.length);
    const back = parsed.documents.map((d) => exchangeDocumentOf(d, BANK_META.account ?? ''));
    BANK_TRANSACTIONS.forEach((t, i) => {
      const d = back[i];
      assert.ok(d);
      assert.equal(d.date, t.date);
      assert.equal(d.direction, t.direction);
      assert.equal(money2(d.amount), money2(t.amount ?? ''));
      assert.equal(d.number, t.docNumber ?? String(i + 1));
      assert.equal(d.counterparty.inn, t.counterparty.inn);
      assert.equal(d.counterparty.account, t.counterparty.account);
      assert.equal(d.counterparty.mfo, t.counterparty.mfo);
      // Names and purposes survive except the letters windows-1251 lacks (folded) and line breaks (one line).
      assert.equal(d.counterparty.name, foldForCp1251(t.counterparty.name));
      assert.equal(d.purpose, foldForCp1251(t.purpose.replace(/\s*\n\s*/g, ' ')));
      assert.equal(d.owner.account, BANK_META.account);
      assert.equal(d.owner.inn, BANK_META.ownerInn);
    });
    // The back-mapped documents rebuild the same file.
    const again = buildBankExchange({
      account: BANK_META.account ?? '', periodFrom: '2026-10-01', periodTo: '2026-10-07', openingBalance: '12500000.00', closingBalance: '27944500.00',
      documents: back, bankKeys: 'uz_mfo', sender: 'Tasnivo', receiver: '1С:Бухгалтерия для Узбекистана', createdAt: NOW,
    });
    assert.deepEqual(again, file.bytes);
  });

  it('a value cannot break the line format, and DOS (cp866) files are read too', () => {
    const text = bankExchangeText({
      account: '20208000900100001001', periodFrom: '2026-10-01', periodTo: '2026-10-01', openingBalance: null, closingBalance: null, bankKeys: 'standard',
      sender: 'x', receiver: 'y', createdAt: NOW,
      documents: [{ number: '1', date: '2026-10-01', amount: '1', direction: 'credit', valueDate: null, purpose: 'a\r\nКонецФайла\r\nb',
        owner: { name: 'O', inn: null, account: '20208000900100001001', bankName: null, mfo: null },
        counterparty: { name: 'C\nКонецДокумента', inn: null, account: null, bankName: null, mfo: null } }],
    });
    assert.equal((text.match(/^КонецФайла$/gm) ?? []).length, 1);
    assert.equal((text.match(/^КонецДокумента$/gm) ?? []).length, 1);
    assert.ok(!/НачальныйОстаток/.test(text), 'no opening balance is invented');
    const dos = iconv.encode(text.replace('Кодировка=Windows', 'Кодировка=DOS'), 'cp866');
    assert.equal(parseBankExchange(dos).documents[0]?.['НазначениеПлатежа'], 'a КонецФайла b');
  });

  it('a partial file leaves the statement balances out', async () => {
    const part = planExport(bankBatch, records(BANK_TRANSACTIONS), 'bank_exchange_1_02', ['r0', 'r1'], none);
    const text = decodeBankExchange((await buildFile(bankBatch, part, 'bank_exchange_1_02', settings({ wholeStatement: false }))).bytes);
    assert.ok(!/НачальныйОстаток|КонечныйОстаток/.test(text));
    assert.match(text, /ВсегоПоступило=15000000\.00\r\nВсегоСписано=3200000\.00/);
  });
});

describe('xlsx formats against golden cell grids', () => {
  it('nomenclature_xlsx: the Uzbek edition\'s attribute names, codes as text, one row per product', async () => {
    const plan = planExport(productBatch, records(PRODUCTS), 'nomenclature_xlsx', undefined, none);
    const file = await buildFile(productBatch, plan, 'nomenclature_xlsx', settings({ filename: 'tovary.xlsx' }));
    assert.equal(file.filename, 'tovary-nomenklatura.xlsx');
    const grid = await xlsxGolden('nomenclature_xlsx.golden.json', file.bytes);
    const sheet = grid['Номенклатура'] ?? [];
    assert.deepEqual(sheet[0], [...NOMENCLATURE_HEADERS]);
    assert.equal(sheet[1]?.[1], '01701001001000000');
    assert.equal(sheet[2]?.[4], '0478000000024', 'a barcode keeps its leading zero');
    assert.equal(sheet.length, 4);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
    assert.equal(wb.worksheets[0]?.getCell('B2').numFmt, '@');
  });

  it('nomenclature_xlsx from an invoice: its lines as products', async () => {
    const plan = planExport(invoiceBatch, records(INVOICE_LINES), 'nomenclature_xlsx', undefined, none);
    const grid = await cells((await buildFile(invoiceBatch, plan, 'nomenclature_xlsx', settings({ filename: 'esf.json' }))).bytes);
    assert.equal(grid['Номенклатура']?.length, 5);
  });

  it('receipt_xlsx: the header block, the lines and the totals', async () => {
    const plan = planExport(invoiceBatch, records(INVOICE_LINES), 'receipt_xlsx', undefined, none);
    assert.deepEqual(plan.checks.find((c) => c.code === 'totals')?.ok, true);
    const file = await buildFile(invoiceBatch, plan, 'receipt_xlsx', settings());
    assert.equal(file.filename, 'postuplenie-ЭСФ-125-2026-10-03.xlsx');
    const grid = await xlsxGolden('receipt_xlsx.golden.json', file.bytes);
    const sheet = Object.values(grid)[0] ?? [];
    assert.deepEqual(sheet[0], ['Поставщик', 'ООО "Ромашка Савдо"']);
    assert.deepEqual(sheet[1], ['ИНН поставщика', '301234567']);
    assert.deepEqual(sheet[6], ['Договор', '4/28 от 01.01.2026']);
    assert.deepEqual(sheet[9], [...RECEIPT_LINE_HEADERS]);
    assert.deepEqual(sheet[10]?.slice(0, 8), ['1', 'Сахар-песок 50 кг', '01701001001000000', '1378325', 'мешок', '10', '45000', '450000']);
    const total = sheet[14] ?? [];
    assert.deepEqual([total[1], total[7], total[9], total[10]], ['Итого', '1950000', '234000', '2184000']);
  });

  it('counterparties_xlsx: one row per distinct counterparty of the statement', async () => {
    const plan = planExport(bankBatch, records(BANK_TRANSACTIONS), 'counterparties_xlsx', undefined, none);
    assert.equal(plan.primary, false);
    const grid = await xlsxGolden('counterparties_xlsx.golden.json', (await buildFile(bankBatch, plan, 'counterparties_xlsx', settings())).bytes);
    const sheet = grid['Контрагенты'] ?? [];
    // Six payments: Ромашка twice (one ИНН), a fee without a counterparty → four rows under the header.
    assert.equal(sheet.length, 5);
    assert.deepEqual(sheet[0], ['Наименование', 'ИНН', 'Расчетный счет', 'МФО', 'Банк']);
  });

  it('the catalogue\'s 1C CSV still comes out of export-1c.ts', async () => {
    const legacy = await import('../export-1c.js');
    assert.equal(legacy.build1cCsv, build1cCsv);
  });
});

describe('plan: what goes and what is left out', () => {
  it('approved records go; unresolved, unapproved and skipped ones are left with their reason', () => {
    const recs = records(BANK_TRANSACTIONS);
    recs[1] = { ...recs[1]!, status: 'unresolved' };
    recs[2] = { ...recs[2]!, status: 'suspicious' };
    recs[3] = { ...recs[3]!, status: 'skipped' };
    recs[4] = { ...recs[4]!, status: 'corrected' };
    recs[5] = { ...recs[5]!, status: 'exported' };
    const plan = planExport(bankBatch, recs, 'bank_exchange_1_02', undefined, none);
    assert.deepEqual(plan.included.map((i) => i.record.id), ['r0', 'r4']);
    assert.deepEqual(plan.left.map((l) => [l.record.id, l.reason]), [['r1', 'unresolved'], ['r2', 'not_approved'], ['r3', 'skipped']]);
    assert.equal(plan.issues.find((i) => i.code === 'unresolved')?.params?.['count'], 2);
    assert.equal(plan.checks.find((c) => c.code === 'review')?.ok, false);
  });

  it('a duplicate within the set and a record exported from another batch are errors', () => {
    const recs = records(BANK_TRANSACTIONS);
    recs[5] = { ...recs[5]!, fingerprint: 'f0' };
    const plan = planExport(bankBatch, recs, 'bank_exchange_1_02', undefined, { exportedElsewhere: new Map([['f2', { batchId: 'other' }]]) });
    assert.deepEqual(plan.left.map((l) => [l.record.id, l.reason]), [['r2', 'duplicate_export'], ['r5', 'duplicate_row']]);
    assert.equal(plan.checks.find((c) => c.code === 'duplicates')?.ok, false);
    // A side file does not care about duplicates.
    assert.equal(planExport(bankBatch, recs, 'counterparties_xlsx', undefined, { exportedElsewhere: new Map([['f2', { batchId: 'other' }]]) }).left.length, 0);
  });

  it('format checks: a bad date, a zero amount and no account keep a record out', () => {
    const bad = [
      { ...BANK_TRANSACTIONS[0]!, date: '2026-02-30' },
      { ...BANK_TRANSACTIONS[0]!, amount: '0' },
      { ...BANK_TRANSACTIONS[0]!, amount: '12,5' },
    ];
    const plan = planExport({ ...bankBatch, meta: { ...BANK_META, account: null } }, records(bad.map((t) => ({ ...t, ourAccount: null }))), 'bank_exchange_1_02', undefined, none);
    assert.equal(plan.included.length, 0);
    const codes = plan.issues.map((i) => `${i.params?.['row']}:${i.code}`);
    assert.ok(codes.includes('1:date_invalid') && codes.includes('2:amount_invalid') && codes.includes('3:amount_invalid') && codes.includes('1:account_invalid'), codes.join());
  });

  it('an unresolved line with no date, amount or direction never reaches a file, even when explicitly chosen', () => {
    const t = { ...BANK_TRANSACTIONS[0]!, date: null, amount: null, direction: null, raw: ['?', '1 5OO'], operationSuggestion: null };
    accounting.BankTransaction.parse(t);
    const plan = planExport(bankBatch, records([t]), 'bank_exchange_1_02', ['r0'], none);
    assert.equal(plan.included.length, 0);
    assert.deepEqual(plan.issues.filter((i) => i.severity === 'error').map((i) => [i.code, i.field]).sort(), [
      ['amount_invalid', 'amount'], ['date_invalid', 'date'], ['payload_invalid', 'direction'],
    ]);
  });

  it('balance: opening + credits − debits must equal closing', () => {
    const plan = planExport({ ...bankBatch, meta: { ...BANK_META, closingBalance: '27944400.00' } }, records(BANK_TRANSACTIONS), 'bank_exchange_1_02', undefined, none);
    assert.equal(plan.checks.find((c) => c.code === 'balance')?.ok, false);
    const mismatch = plan.issues.find((i) => i.code === 'balance_mismatch');
    assert.deepEqual(mismatch?.params, { expected: '27944400', actual: '27944500' });
  });

  it('invoice totals: the lines must add up to the header', () => {
    const plan = planExport({ ...invoiceBatch, meta: { ...INVOICE_META, totalWithVat: '2185000' } }, records(INVOICE_LINES), 'receipt_xlsx', undefined, none);
    assert.equal(plan.checks.find((c) => c.code === 'totals')?.ok, false);
    assert.ok(plan.issues.some((i) => i.code === 'totals_mismatch' && i.field === 'total'));
    // Line maths: 10 × 45 000 ≠ 460 000.
    const lines = [{ ...INVOICE_LINES[0]!, amount: '460000' }];
    assert.ok(planExport(invoiceBatch, records(lines), 'receipt_xlsx', undefined, none).issues.some((i) => i.code === 'totals_mismatch' && i.field === 'amount'));
  });

  it('a payload that does not parse is an issue on its field, not a crash', () => {
    const plan = planExport(bankBatch, records([{ ...BANK_TRANSACTIONS[0]!, counterparty: { ...BANK_TRANSACTIONS[0]!.counterparty, inn: '12' } }]), 'bank_exchange_1_02', undefined, none);
    assert.deepEqual(plan.issues.filter((i) => i.params?.['row']).map((i) => [i.code, i.field]), [['inn_invalid', 'counterparty.inn']]);
    assert.equal(plan.left[0]?.reason, 'invalid');
  });

  it('explicit record ids may re-send an exported record', () => {
    const recs = records(BANK_TRANSACTIONS).map((r) => ({ ...r, status: 'exported' as const }));
    assert.equal(planExport(bankBatch, recs, 'bank_exchange_1_02', undefined, none).included.length, 0);
    assert.equal(planExport(bankBatch, recs, 'bank_exchange_1_02', ['r0', 'r3'], none).included.length, 2);
  });
});

describe('helpers', () => {
  it('decimals are exact', () => {
    assert.equal(fromMicros((toMicros('0.1') ?? 0n) + (toMicros('0.2') ?? 0n)), '0.3');
    assert.equal(money2('1500'), '1500.00');
    assert.equal(money2('1500.005'), '1500.01');
    assert.equal(money2('-0.004'), '0.00');
    assert.equal(toMicros('1,5'), null);
  });

  it('names fold case, ё, quotes, legal forms and spaces', () => {
    const same = ['ООО "Ромашка Савдо"', 'ооо «РОМАШКА  САВДО»', 'Ромашка Савдо ООО', 'OOO Romashka', 'Общество с ограниченной ответственностью «Ромашка Савдо»'];
    assert.deepEqual(new Set(same.slice(0, 3).map(normalizeName)), new Set(['ромашка савдо']));
    assert.equal(normalizeName(same[4]!), 'ромашка савдо');
    assert.equal(normalizeName('OOO Romashka'), 'romashka');
    assert.equal(normalizeName('Qurilish Gʻisht MChJ'), normalizeName("QURILISH G'ISHT mchj"));
    assert.equal(normalizeName('Ёлка'), 'елка');
    assert.equal(normalizeName('ООО'), 'ооо');
  });

  it('bank fingerprints ignore how the amount is written', () => {
    const t = BANK_TRANSACTIONS[0]!;
    assert.equal(bankFingerprint(t), bankFingerprint({ ...t, amount: '15000000' }));
    assert.notEqual(bankFingerprint(t), bankFingerprint({ ...t, docNumber: '999' }));
  });
});

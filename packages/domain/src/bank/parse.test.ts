// The four statement fixtures (fixtures/make-fixtures.ts) end to end through the reader: layout
// recognised, rows read and left out with their reason, values normalised, issues raised, and the
// balance (opening + credits − debits = closing) checked to the tiyin.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { addDecimals, subDecimals } from './decimal.js';
import { readLines, readStatementFile, type StatementFile } from './read.js';
import { reconcile } from './reconcile.js';

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

async function read(name: string): Promise<{ file: StatementFile; parsed: ReturnType<typeof readLines> }> {
  const file = await readStatementFile(fixture(name));
  assert.ok(file.builtIn, `${name}: a built-in layout is recognised`);
  return { file, parsed: readLines(file, file.builtIn.layout) };
}

const codes = (parsed: ReturnType<typeof readLines>, row: number): string[] => parsed.lines.find((l) => l.rowIndex === row)?.issues.map((i) => i.code) ?? ['<no line>'];
const reasons = (parsed: ReturnType<typeof readLines>): string[] => parsed.dropped.map((d) => `${d.rowIndex}:${d.reason}`);

function balanceOf(parsed: ReturnType<typeof readLines>) {
  return reconcile(
    { openingBalance: parsed.meta.openingBalance, closingBalance: parsed.meta.closingBalance, bankTotals: parsed.extra.bankTotals, dropped: [] },
    parsed.lines.map((l) => ({ rowIndex: l.rowIndex, status: 'valid', payload: l.payload, issues: l.issues, note: null })),
  );
}

describe('RU statement, two-row header, debit and credit columns (ru-debit-credit.xlsx)', () => {
  it('finds the layout, joins the two header rows and reads the title block', async () => {
    const { file, parsed } = await read('ru-debit-credit.xlsx');
    assert.equal(file.builtIn?.format.id, 'generic_ru_debit_credit');
    assert.equal(file.builtIn?.format.verified, false, 'generic layouts stay unverified until a real file confirms them');
    assert.equal(file.sheet.headerRow, 9);
    assert.equal(file.sheet.twoRowHeader, true);
    assert.deepEqual(file.sheet.headers, ['Дата', '№ док.', 'Корреспондент Наименование', 'Корреспондент ИНН', 'Корреспондент Счет', 'Корреспондент МФО', 'Сумма Дебет', 'Сумма Кредит', 'Назначение платежа']);
    assert.equal(parsed.meta.account, '20208000900123456001', 'the spaced account of the title');
    assert.equal(parsed.extra.ownInn, '301234567');
    assert.equal(parsed.extra.ownName, 'ООО «Тасниво Тест»');
    assert.equal(parsed.meta.bankName, 'АКБ «Намуна Банк» (образец)');
    assert.equal(parsed.meta.currency, 'UZS');
    assert.deepEqual([parsed.meta.periodFrom, parsed.meta.periodTo], ['2026-10-01', '2026-10-31']);
  });

  it('reads 10 lines and leaves out the column numbers, the totals, the closing balance and the footer', async () => {
    const { parsed } = await read('ru-debit-credit.xlsx');
    assert.equal(parsed.lines.length, 10);
    assert.deepEqual(reasons(parsed), ['11:column_numbers', '19:continuation', '23:totals', '24:closing_balance', '26:footer']);
  });

  it('normalises values: text and number cells, PINFL, zeros as no ИНН, the wrapped purpose joined', async () => {
    const { parsed } = await read('ru-debit-credit.xlsx');
    const at = (row: number) => parsed.lines.find((l) => l.rowIndex === row)?.payload;
    assert.deepEqual([at(12)?.date, at(12)?.direction, at(12)?.amount, at(12)?.contract], ['2026-10-01', 'credit', '12500000', '4/28 от 01.01.2026']);
    assert.deepEqual([at(13)?.direction, at(13)?.amount, at(13)?.counterparty.inn], ['debit', '1234567.89', '31203851234567']);
    assert.equal(at(14)?.counterparty.inn, null, '000000000 is the bank\'s "unknown"');
    assert.equal(at(17)?.counterparty.mfo, '00440');
    assert.equal(at(18)?.purpose, 'Оплата по счету-фактуре №112 от 05.10.2026 за строительные материалы');
    assert.equal(at(20)?.amount, '1234567.89', 'a number cell');
    assert.equal(at(20)?.ourAccount, '20208000900123456001');
    assert.deepEqual(codes(parsed, 14), ['counterparty_missing'], 'a bank fee names no counterparty');
    assert.deepEqual(codes(parsed, 15), ['counterparty_missing'], 'an acquiring line names no counterparty');
    assert.deepEqual(codes(parsed, 12), []);
  });

  it('reconciles: 15 000 000 + 22 184 567.89 − 12 779 221.89 = 24 405 346, and the bank\'s totals match', async () => {
    const { parsed } = await read('ru-debit-credit.xlsx');
    assert.equal(parsed.meta.openingBalance, '15000000', 'read from the title row');
    assert.equal(parsed.meta.closingBalance, '24405346');
    const r = balanceOf(parsed);
    assert.equal(r.totalCredit, '22184567.89');
    assert.equal(r.totalDebit, '12779221.89');
    assert.equal(r.computedClosing, '24405346');
    assert.equal(r.balanced, true);
    assert.deepEqual([r.bankTotals.debitMatches, r.bankTotals.creditMatches], [true, true]);
  });
});

describe('UZ Latin statement, serial dates and number cells, with broken rows (uz-debit-credit.xlsx)', () => {
  it('finds the Uzbek layout and the title block', async () => {
    const { file, parsed } = await read('uz-debit-credit.xlsx');
    assert.equal(file.builtIn?.format.id, 'generic_uz_debit_credit');
    assert.equal(file.sheet.headerRow, 6);
    assert.equal(parsed.meta.account, '20208000900123456001');
    assert.equal(parsed.extra.ownInn, '301234567');
    assert.equal(parsed.meta.currency, 'UZS', "«so'm» in the title");
  });

  it('reads 10 lines; balances, totals, the layout row and the page footer are left out', async () => {
    const { parsed } = await read('uz-debit-credit.xlsx');
    assert.equal(parsed.lines.length, 10);
    assert.deepEqual(reasons(parsed), ['7:opening_balance', '18:totals', '19:totals', '20:closing_balance', '21:footer']);
  });

  it('raises an issue for every broken row and never guesses a value', async () => {
    const { parsed } = await read('uz-debit-credit.xlsx');
    const at = (row: number) => parsed.lines.find((l) => l.rowIndex === row)?.payload;
    assert.equal(at(8)?.date, '2026-10-01', 'Excel serial 46296');
    assert.equal(at(9)?.amount, '1234567.89', 'number cell');
    assert.deepEqual(codes(parsed, 13), ['date_invalid']);
    assert.equal(at(13)?.date, null);
    assert.deepEqual(codes(parsed, 14), ['inn_invalid', 'account_invalid']);
    assert.equal(at(14)?.counterparty.mfo, '00491', 'МФО "491" padded back');
    assert.deepEqual(codes(parsed, 15), ['amount_both_columns']);
    assert.deepEqual([at(15)?.amount, at(15)?.direction], [null, null]);
    assert.deepEqual(codes(parsed, 16), ['amount_invalid']);
    assert.deepEqual(codes(parsed, 17), ['date_missing', 'purpose_missing']);
    assert.equal(at(8)?.contract, '7 от 01.09.2026', 'shartnoma № 7 dan 01.09.2026');
  });

  it('reconciles over every line with an amount', async () => {
    const { parsed } = await read('uz-debit-credit.xlsx');
    const r = balanceOf(parsed);
    assert.equal(r.openingBalance, '7250000.5');
    assert.equal(r.computedClosing, subDecimals(addDecimals('7250000.5', '3580000'), '5844567.89'));
    assert.equal(r.balanced, true);
    assert.deepEqual([r.bankTotals.debitMatches, r.bankTotals.creditMatches], [true, true]);
  });
});

describe('one amount + Дебет/Кредит flag, dates with time, page break (amount-direction.xlsx)', () => {
  it('finds the flag layout and its columns', async () => {
    const { file } = await read('amount-direction.xlsx');
    assert.equal(file.builtIn?.format.id, 'generic_amount_direction');
    assert.equal(file.builtIn?.layout.conventions.direction, 'flag');
    const map = file.builtIn?.layout.columnMap;
    assert.deepEqual([map?.amount, map?.direction, map?.reference, map?.currency, map?.debit], [6, 7, 9, 10, -1]);
  });

  it('drops the page footer and the repeated header, reads 6 lines', async () => {
    const { parsed } = await read('amount-direction.xlsx');
    assert.equal(parsed.lines.length, 6);
    assert.deepEqual(reasons(parsed), ['8:footer', '9:repeated_header', '13:closing_balance', '14:footer']);
  });

  it('dates with a time, flags, an unknown flag left unresolved', async () => {
    const { parsed } = await read('amount-direction.xlsx');
    const at = (row: number) => parsed.lines.find((l) => l.rowIndex === row)?.payload;
    assert.deepEqual([at(5)?.date, at(5)?.direction, at(5)?.amount, at(5)?.reference], ['2026-10-01', 'credit', '1000000', 'TRX-0001']);
    assert.deepEqual([at(6)?.direction, at(6)?.amount], ['debit', '12345.67']);
    assert.deepEqual(codes(parsed, 12), ['direction_missing']);
    assert.equal(at(12)?.direction, null);
  });

  it('reconciles with the opening balance from the title rows', async () => {
    const { parsed } = await read('amount-direction.xlsx');
    const r = balanceOf(parsed);
    assert.equal(r.openingBalance, '500000');
    assert.equal(r.closingBalance, '1929597.78');
    assert.equal(r.balanced, true);
  });
});

describe('signed amounts in a windows-1251 CSV (signed-1251.csv)', () => {
  it('decodes, finds the signed layout and reads the sign as the direction', async () => {
    const { file, parsed } = await read('signed-1251.csv');
    assert.equal(file.builtIn?.layout.conventions.direction, 'signed');
    assert.equal(parsed.lines.length, 3);
    assert.deepEqual(parsed.lines.map((l) => [l.payload.direction, l.payload.amount]), [['credit', '2000000'], ['debit', '750000.5'], ['debit', '12000']]);
    assert.equal(parsed.lines[0]?.payload.counterparty.name, 'ООО «Альфа Трейд»');
    assert.deepEqual(reasons(parsed), ['6:totals']);
    assert.equal(parsed.meta.account, '20208000900123456001');
  });
});

describe('fingerprints', () => {
  it('the same bytes give the same fingerprint, different files differ', async () => {
    const a = await readStatementFile(fixture('ru-debit-credit.xlsx'));
    const b = await readStatementFile(fixture('ru-debit-credit.xlsx'));
    const c = await readStatementFile(fixture('uz-debit-credit.xlsx'));
    assert.equal(a.fingerprint, b.fingerprint);
    assert.notEqual(a.fingerprint, c.fingerprint);
    assert.match(a.fingerprint, /^[0-9a-f]{64}$/);
  });
});

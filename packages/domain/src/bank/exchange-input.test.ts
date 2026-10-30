// A bank's own kl_to_1c.txt read as a statement, on the ten real 1CClientBankExchange files of the
// 30 Oct research (../onec/fixtures/bank-input/SOURCES.md): encodings by content, document counts,
// the printed balances against the lines, every quirk bank research §7.1–25 lists, and the file
// Tasnivo writes read back by the same reader (§7.44). Checklist items in the comments.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import iconv from 'iconv-lite';
import { buildBankExchange, parseBankExchange, type ExchangeDocument } from '../onec/bank-exchange.js';
import { readLines, readStatementFile, type StatementFile } from './read.js';
import { reconcile, reconcileAccounts } from './reconcile.js';

const sample = (name: string): Buffer => readFileSync(new URL(`../onec/fixtures/bank-input/${name}`, import.meta.url));

async function read(bytes: Buffer): Promise<{ file: StatementFile; parsed: ReturnType<typeof readLines> }> {
  const file = await readStatementFile(bytes);
  assert.equal(file.builtIn?.format.id, 'onec_client_bank_exchange', 'read as a kl_to_1c statement');
  return { file, parsed: readLines(file, file.builtIn.layout) };
}

function balance(parsed: ReturnType<typeof readLines>) {
  return reconcile(
    { openingBalance: parsed.meta.openingBalance, closingBalance: parsed.meta.closingBalance, bankTotals: parsed.extra.bankTotals, dropped: [] },
    parsed.lines.map((l) => ({ rowIndex: l.rowIndex, status: 'valid', payload: l.payload, issues: l.issues, note: null })),
  );
}

const codes = (parsed: ReturnType<typeof readLines>): string[] => [...new Set(parsed.lines.flatMap((l) => l.issues.map((i) => i.code)))].sort();

describe('the ten real kl_to_1c samples', () => {
  // bank §7.1 §7.2 §7.15 §7.25: marker, encoding by content, versions 1.01–1.03, printed balances against the lines.
  const cases = [
    { file: 'habr-245397.kl_to_1c.txt', encoding: 'utf-8', lines: 4, account: '12345678901234567890', opening: '0', closing: '0', printed: ['68770', '68770'], sums: ['4520', '4770'], difference: '250' },
    { file: 'ibank2-format-guide.cp1251.kl_to_1c.txt', encoding: 'windows-1251', lines: 2, account: '40702810300180001774', opening: '306726.37', closing: '304846.37', printed: ['1999', '119'], sums: ['1999', '119'], difference: '0' },
    { file: 'kilylabs-one-day.cp1251.kl_to_1c.txt', encoding: 'windows-1251', lines: 13, account: '40702810200000000001', opening: '45329.91', closing: '44145.91', printed: ['41184', '40000'], sums: ['41184', '40000'], difference: '0' },
    { file: 'kilylabs-one-day.utf8.kl_to_1c.txt', encoding: 'utf-8', lines: 13, account: '40702810200000000001', opening: '45329.91', closing: '44145.91', printed: ['41184', '40000'], sums: ['41184', '40000'], difference: '0' },
    { file: 'odin-palace-bench.cp1251.kl_to_1c.txt', encoding: 'windows-1251', lines: 129, account: '40802000000000000549', opening: '316277.35', closing: '700675.2', printed: ['642958.31', '1027356.16'], sums: ['642268.31', '1027356.16'], difference: '690' },
    { file: 'odin-palace-bom.kl_to_1c.txt', encoding: 'utf-8', lines: 1, account: '40802000000000000007', opening: '0', closing: '67770', printed: ['0', '67770'], sums: ['0', '1000'], difference: '-66770' },
    { file: 'odin-palace-duplicate-interval.kl_to_1c.txt', encoding: 'utf-8', lines: 0, account: '40702810000000000111', opening: '500', closing: '1300', printed: [null, null], sums: ['0', '0'], difference: '-800' },
    { file: 'odoo-ru-1.01.cp1251.kl_to_1c.txt', encoding: 'windows-1251', lines: 1, account: '00000000000000000001', opening: '110978', closing: '2818.88', printed: ['108159.12', '0'], sums: ['108159.12', '0'], difference: '0' },
    { file: 'odin-palace-readme.cp866.kl_to_1c.txt', encoding: 'cp866', lines: 1, account: '40802000000000000007', opening: '0', closing: '67770', printed: ['0', '67770'], sums: ['0', '1000'], difference: '-66770' },
  ] as const;
  for (const c of cases) {
    it(`${c.file}: ${c.lines} lines, ${c.encoding}, balances reported against the lines`, async () => {
      const { file, parsed } = await read(sample(c.file));
      assert.equal(file.source.kind, 'exchange');
      assert.equal(file.source.encoding, c.encoding);
      assert.equal(parsed.lines.length, c.lines);
      assert.equal(parsed.meta.account, c.account);
      assert.deepEqual([parsed.meta.openingBalance, parsed.meta.closingBalance], [c.opening, c.closing]);
      // B6: the meta totals are the bank's printed ones; the lines' own sums are kept apart.
      assert.deepEqual([parsed.meta.totalDebit, parsed.meta.totalCredit], c.printed);
      assert.deepEqual([parsed.extra.lineTotals.debit, parsed.extra.lineTotals.credit], c.sums);
      const report = balance(parsed);
      assert.equal(report.difference, c.difference, 'a mismatch is reported, not refused');
      if (c.printed[0] !== null) assert.equal(report.bankTotals.debitMatches, c.printed[0] === c.sums[0]);
      for (const l of parsed.lines) {
        assert.ok(l.payload.date && l.payload.amount && l.payload.direction, `${c.file} row ${l.rowIndex} fully read`);
        assert.equal(l.payload.ourAccount, c.account);
      }
    });
  }

  it('unact-1.03-two-accounts: two accounts, transfers between them are a debit and a credit, each account reconciles', async () => {
    // bank §7.7 §7.13 §7.15 §7.40: repeated РасчСчет= header lines, direction by the own accounts, one summary per account.
    const { file, parsed } = await read(sample('unact-1.03-two-accounts.kl_to_1c.txt'));
    assert.equal(file.source.encoding, 'utf-8');
    assert.deepEqual(parseBankExchange(sample('unact-1.03-two-accounts.kl_to_1c.txt')).headerAll['Документ'], ['Type 1', 'Type 2']);
    assert.equal(parsed.lines.length, 12, 'six documents, each a debit of one own account and a credit of the other');
    const accounts = parsed.extra.accounts ?? [];
    assert.deepEqual(accounts.map((a) => [a.account, a.lines, a.lineDebit, a.lineCredit, a.debit, a.credit]), [
      ['40700000000000000000', 6, '294', '294', '294', '294'],
      ['40600000000000000000', 6, '294', '294', '294', '294'],
    ]);
    assert.ok(reconcileAccounts(accounts).every((a) => a.balanced && a.debitMatches && a.creditMatches));
    assert.equal(new Set(parsed.lines.map((l) => l.rowIndex)).size, 12, 'row numbers stay unique (import_record unique key)');
    // bank §7.18: `ПлательщикБИК=Payer bank BIC` is kept out of the МФО with a warning; §7.17: all-zero ИНН reads as none.
    assert.deepEqual(codes(parsed), ['mfo_invalid']);
    assert.ok(parsed.lines.every((l) => l.payload.counterparty.inn === null && l.payload.counterparty.mfo === null));
    // bank §7.22: КодНазПлатежа "Payment purpose" is not a 5-digit code and is not invented.
    assert.ok(parsed.lines.every((l) => l.payload.purposeCode === null));
  });
});

describe('kl_to_1c quirks of the real files', () => {
  it('habr: duplicate key keeps the first value with a warning, spaces after =, composite names, empty dates', async () => {
    // bank §7.5 §7.8 §7.12 §7.16 §7.17
    const { file, parsed } = await read(sample('habr-245397.kl_to_1c.txt'));
    assert.deepEqual(file.warnings, [{ line: 33, code: 'duplicate_key', key: 'ПлательщикКорсчет' }]);
    const raw = parseBankExchange(sample('habr-245397.kl_to_1c.txt'));
    assert.equal(raw.documents[0]?.['ПлательщикИНН'], '990000000001', 'the space after = is trimmed');
    const [fee, incoming, fee2, payment] = parsed.lines;
    assert.deepEqual([fee?.payload.direction, fee?.payload.amount, fee?.payload.counterparty.name], ['debit', '1000', 'ОАО АКБ "Солнышко"']);
    assert.deepEqual([incoming?.payload.direction, incoming?.payload.amount, incoming?.payload.counterparty.name], ['credit', '4770', 'ООО "ВИОСН"']);
    assert.equal(fee2?.payload.direction, 'debit');
    assert.equal(payment?.payload.purpose, 'Сумма 3500.00, в т.ч. НДС - 388,99');
    // A 10-digit Russian ИНН is not an Uzbek ИНН/ПИНФЛ: kept out with a warning, never padded or cut.
    assert.ok(parsed.lines.every((l) => l.issues.some((i) => i.code === 'inn_invalid')));
    assert.equal(file.sheet.body[0]?.cells[14], 'Банковский ордер', 'the document kind is kept as written (§7.10)');
  });

  it('the composite form of the iBank2 vendor example and ИНН\\КПП names fill the name when …1 is empty', async () => {
    // bank §7.16
    const text = iconv.decode(sample('ibank2-format-guide.cp1251.kl_to_1c.txt'), 'win1251')
      .replace('Плательщик1=ЗАО "Березка"\r\n', '')
      .replace('ПлательщикИНН=990000000002\r\n', '')
      .replace('Плательщик=990000000002 ЗАО "Березка"', 'Плательщик=ИНН 302345678\\775001001 ЗАО "Березка"');
    const { parsed } = await read(iconv.encode(text, 'win1251'));
    const incoming = parsed.lines.find((l) => l.payload.direction === 'credit');
    assert.deepEqual([incoming?.payload.counterparty.name, incoming?.payload.counterparty.inn], ['ЗАО "Березка"', '302345678']);
  });

  it('odoo-ru 1.01: blank lines, leading-zero account, posting date, a comma amount inside the purpose', async () => {
    // bank §7.6 §7.11 §7.19 §7.20 §7.21 §7.34
    const { parsed } = await read(sample('odoo-ru-1.01.cp1251.kl_to_1c.txt'));
    const line = parsed.lines[0];
    assert.equal(line?.payload.ourAccount, '00000000000000000001');
    assert.deepEqual([line?.payload.date, line?.payload.valueDate], ['2023-03-31', '2023-04-03']);
    assert.equal(line?.payload.purpose, 'Оплата по счету N 1024 от 01.01.23г 18026,52');
    assert.equal(line?.payload.amount, '108159.12');
    assert.equal(line?.payload.purposeCode, null, 'empty budget fields create no values');
  });

  it('odin_palace duplicate_interval: identical account sections count once, May and June chain', async () => {
    // bank §7.14
    const { file, parsed } = await read(sample('odin-palace-duplicate-interval.kl_to_1c.txt'));
    assert.deepEqual(file.warnings, [{ code: 'repeated_section', account: '40702810000000000111' }]);
    assert.deepEqual([parsed.meta.periodFrom, parsed.meta.periodTo], ['2024-05-01', '2024-06-30']);
    assert.deepEqual([parsed.meta.openingBalance, parsed.meta.closingBalance], ['500', '1300']);
  });

  it('truncated files: no КонецДокумента, no КонецРасчСчет, no КонецФайла are recovered with a warning', async () => {
    // bank §7.9 (odin_palace suites no_end_of_document / no_end_of_account / no_end_of_file)
    const base = iconv.decode(sample('odin-palace-readme.cp866.kl_to_1c.txt'), 'cp866');
    const variants: [string, string][] = [
      [base.replace('КонецДокумента\r\n', ''), 'missing_end_document'],
      [base.replace('КонецРасчСчет\r\n', ''), 'missing_end_account'],
      [base.replace('КонецФайла\r\n', ''), 'missing_end_file'],
    ];
    for (const [text, code] of variants) {
      const { file, parsed } = await read(iconv.encode(text, 'cp866'));
      assert.ok(file.warnings.some((w) => w.code === code), code);
      assert.equal(parsed.lines.length, 1, code);
      assert.equal(parsed.lines[0]?.payload.amount, '1000', code);
      assert.equal(parsed.meta.openingBalance, '0', code);
    }
  });

  it('Сумма with a comma is refused on the line, an Uzbek МФО and purpose code are read, an unknown version is a warning', async () => {
    // bank §7.11 §7.18 §7.22 §7.25
    const base = iconv.decode(sample('odin-palace-readme.cp866.kl_to_1c.txt'), 'cp866')
      .replace('ВерсияФормата=1.02', 'ВерсияФормата=1.05')
      .replace('ПлательщикБИК=044525593', 'ПлательщикБИК=00444')
      .replace('НазначениеПлатежа=Оплата по договору', 'КодНазПлатежа=00664\r\nНазначениеПлатежа=Оплата по договору');
    const good = await read(iconv.encode(base, 'cp866'));
    assert.ok(good.file.warnings.some((w) => w.code === 'unknown_version'));
    assert.deepEqual([good.parsed.lines[0]?.payload.counterparty.mfo, good.parsed.lines[0]?.payload.purposeCode], ['00444', '00664']);
    const bad = await read(iconv.encode(base.replace('Сумма=1000', 'Сумма=1000,50'), 'cp866'));
    assert.equal(bad.parsed.lines[0]?.payload.amount, null);
    assert.ok(bad.parsed.lines[0]?.issues.some((i) => i.code === 'amount_invalid'));
  });

  it('НазначениеПлатежа1..6 are joined when НазначениеПлатежа is absent', async () => {
    // bank §7.23
    const text = sample('unact-1.03-two-accounts.kl_to_1c.txt').toString('utf8').replace(/^НазначениеПлатежа=Payment purpose\r?\n/gm, '');
    const { parsed } = await read(Buffer.from(text, 'utf8'));
    assert.equal(parsed.lines[0]?.payload.purpose, 'Payment purpose 1 Payment purpose 2 Payment purpose 3 Payment purpose 4 Payment purpose 5 Payment purpose 6');
  });
});

describe('the kl_to_1c.txt Tasnivo writes, read back (bank §7.44)', () => {
  const party = (name: string, inn: string | null, account: string, mfo: string | null) => ({ name, inn, account, bankName: 'АИКБ «Ипак Йули»', mfo });
  const A = '20208000900123456001';
  const B = '20208840900123456002';
  const documents: ExchangeDocument[] = [
    { number: '1', date: '2026-10-01', amount: '12500000', direction: 'credit', owner: party('ООО «Тасниво Тест»', '301234567', A, '00444'), counterparty: party('OOO «Qurilish Savdo»', '302345678', '20208000400987654001', '00444'), purpose: 'Оплата за услуги', valueDate: '2026-10-02', purposeCode: '00664' },
    { number: '1', date: '2026-10-01', amount: '45000.5', direction: 'debit', owner: party('ООО «Тасниво Тест»', '301234567', A, '00444'), counterparty: party('Ҳамкорбанк ғазнаси', null, '29801000900000000444', '00873'), purpose: '00667 Комиссия банка', valueDate: null, purposeCode: '00667' },
    { number: '7', date: '2026-10-03', amount: '1000', direction: 'debit', owner: party('ООО «Тасниво Тест»', '301234567', B, '00444'), counterparty: party('Davlat soliq qoʻmitasi', '200000000', '23402000300100001010', '00014'), purpose: 'Уплата налога', valueDate: null, purposeCode: null },
  ];
  const bytes = buildBankExchange({
    account: A, periodFrom: '2026-10-01', periodTo: '2026-10-31', openingBalance: null, closingBalance: null, documents,
    sections: [{ account: A, openingBalance: '1000000', closingBalance: '13454999.5' }, { account: B, openingBalance: '5000', closingBalance: '4000' }],
    bankKeys: 'standard', sender: 'Tasnivo', receiver: '1С:Бухгалтерия для Узбекистана', createdAt: new Date('2026-10-30T09:00:00Z'),
  });

  it('cp1251 without BOM, CRLF, one section per account, unique numbers, dates by direction', () => {
    assert.equal(bytes.subarray(0, 3).toString('latin1'), '1CC', 'no byte-order mark');
    const text = iconv.decode(bytes, 'win1251');
    assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF');
    assert.deepEqual(text.match(/^РасчСчет=.*$/gm)?.slice(0, 2).map((l) => l.trim()), [`РасчСчет=${A}`, `РасчСчет=${B}`]);
    assert.equal((text.match(/^СекцияРасчСчет\r$/gm) ?? []).length, 2);
    assert.deepEqual(text.match(/^Номер=.*$/gm)?.map((l) => l.trim()), ['Номер=1', 'Номер=1/2', 'Номер=7'], '(account, date, number) unique per file');
    assert.ok(text.includes('НазначениеПлатежа=00664 Оплата за услуги'), 'the code opens the purpose');
    assert.ok(text.includes('НазначениеПлатежа=00667 Комиссия банка'), 'never twice');
    assert.equal((text.match(/^ДатаСписано=/gm) ?? []).length, 2);
    assert.equal((text.match(/^ДатаПоступило=/gm) ?? []).length, 1);
    assert.ok(text.includes('ПолучательБИК=00873'), 'the МФО goes into …БИК');
    assert.ok(text.trimEnd().endsWith('КонецФайла'));
  });

  it('round trip: written, then read by our own reader, gives the same documents and balances', async () => {
    const { file, parsed } = await read(bytes);
    assert.equal(file.source.encoding, 'windows-1251');
    assert.equal(parsed.lines.length, documents.length);
    documents.forEach((d, i) => {
      const p = parsed.lines[i]?.payload;
      assert.deepEqual(
        [p?.date, p?.amount, p?.direction, p?.ourAccount, p?.counterparty.account, p?.counterparty.inn, p?.counterparty.mfo, p?.valueDate, p?.purposeCode],
        [d.date, d.amount, d.direction, d.owner.account, d.counterparty.account, d.counterparty.inn, d.counterparty.mfo, d.valueDate, d.purposeCode],
        `document ${i}`,
      );
    });
    assert.equal(parsed.lines[1]?.payload.counterparty.name, 'Хамкорбанк газнаси', 'Uzbek letters folded as windows-1251 must');
    assert.deepEqual(parsed.lines.map((l) => l.payload.docNumber), ['1', '1/2', '7']);
    const accounts = parsed.extra.accounts ?? [];
    assert.deepEqual(accounts.map((a) => [a.account, a.opening, a.closing, a.debit, a.credit]), [[A, '1000000', '13454999.5', '45000.5', '12500000'], [B, '5000', '4000', '1000', '0']]);
    assert.ok(reconcileAccounts(accounts).every((a) => a.balanced !== false));
  });
});

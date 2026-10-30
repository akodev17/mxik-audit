// kl_to_1c.txt against the letter of the 1C client-bank standard (bank research §1.2–1.3 and
// checklist §7.44; onec research §4.2 and checklist §8.18–20): bytes in the declared code page and
// no BOM, CRLF, ВерсияФормата, both Кодировка values written and read back by our own reader, the
// МФО in …БИК, and (РасчСчет, вид, Дата, Номер) unique in the file. No database.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import iconv from 'iconv-lite';
import { buildBankExchange, decodeBankExchange, exchangeDocumentOf, parseBankExchange, type ExchangeDocument, type ExchangeFile } from './bank-exchange.js';

const owner = { name: 'ООО «Тасниво Тест»', inn: '300000001', account: '20208000900100001001', bankName: 'АКБ «Ипак Йули»', mfo: '00444' };
const doc = (number: string, date: string, direction: 'debit' | 'credit', amount: string, counterparty: string, mfo: string): ExchangeDocument => ({
  number, date, amount, direction, owner,
  counterparty: { name: counterparty, inn: '301234567', account: '20208000100200300401', bankName: 'Hamkorbank', mfo },
  purpose: `Оплата по договору №4/28 — «${counterparty}»`, valueDate: null,
});

const file = (encoding?: 'Windows' | 'DOS'): ExchangeFile => ({
  account: owner.account, periodFrom: '2026-10-01', periodTo: '2026-10-07', openingBalance: '12500000.00', closingBalance: null,
  documents: [
    doc('101', '2026-10-01', 'credit', '15000000.00', 'ООО "Ромашка Савдо"', '00083'),
    doc('57', '2026-10-02', 'debit', '3200000', 'MChJ «Qurilish Gʻisht»', '00873'),
    // Two payments the bank numbered alike on one day: 1C would take the second for the first.
    doc('58', '2026-10-04', 'debit', '1000.50', 'ЧП Иванов', '00444'),
    doc('58', '2026-10-04', 'debit', '2000.00', 'ЧП Петров', '00444'),
    doc('58', '2026-10-05', 'debit', '3000.00', 'ЧП Сидоров', '00444'),
  ],
  bankKeys: 'standard', sender: 'Tasnivo', receiver: '1С:Бухгалтерия для Узбекистана', createdAt: new Date('2026-10-30T09:00:00Z'),
  ...(encoding ? { encoding } : {}),
});

describe('kl_to_1c.txt conformance (bank §7.44, onec §8.18–20)', () => {
  it('Windows: cp1251 bytes without a BOM, CRLF only, ВерсияФормата and Кодировка first, read back by our reader', () => {
    // bank §7.44 / onec §8.18: «файл не является файлом обмена или неверно указана кодировка» when bytes and Кодировка disagree.
    const bytes = buildBankExchange(file());
    assert.equal(bytes.subarray(0, 20).toString('latin1'), '1CClientBankExchange', 'no BOM before the marker');
    const text = iconv.decode(bytes, 'win1251');
    assert.ok(!/(^|[^\r])\n/.test(text), 'every line ends in CRLF');
    assert.deepEqual(text.split('\r\n').slice(0, 3), ['1CClientBankExchange', 'ВерсияФормата=1.02', 'Кодировка=Windows']);
    assert.equal(bytes.indexOf(Buffer.from('Кодировка', 'utf8')), -1, 'not UTF-8');
    assert.equal(text.split('\r\n').at(-2), 'КонецФайла');
    const parsed = parseBankExchange(bytes);
    assert.equal(parsed.documents.length, 5);
    assert.equal(parsed.accounts[0]?.['ВсегоСписано'], '3206000.50');
    assert.equal(parsed.accounts[0]?.['НачальныйОстаток'], '12500000.00');
    assert.equal(exchangeDocumentOf(parsed.documents[1]!, owner.account).counterparty.name, 'MChJ «Qurilish G\'isht»', 'ʻ folded, the rest kept');
  });

  it('DOS: the same file in cp866, its bytes really cp866, and the reader picks the code page by Кодировка (onec §8.18)', () => {
    // onec §8.18: «Кодировка=DOS|Windows; file bytes must really be CP866 or Windows-1251 accordingly».
    const dos = buildBankExchange(file('DOS'));
    const win = buildBankExchange(file());
    assert.equal(dos.subarray(0, 20).toString('latin1'), '1CClientBankExchange');
    // «К» is 0x8A in cp866 and 0xCA in cp1251.
    assert.ok(dos.includes(Buffer.from([0x8a])) && !win.includes(Buffer.from([0x8a])));
    const text = decodeBankExchange(dos);
    assert.match(text, /\r\nКодировка=DOS\r\n/);
    const a = parseBankExchange(dos);
    const b = parseBankExchange(win);
    assert.equal(a.header['Кодировка'], 'DOS');
    // The same documents both ways (cp866 has no «», written as plain quotes).
    const plain = (d: Record<string, string>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.replace(/[«»]/g, '"')]));
    assert.deepEqual(a.documents.map(plain), b.documents.map(plain));
    assert.deepEqual(a.accounts, b.accounts);
  });

  it('the МФО goes where the standard has the bank code, 5 digits with its zeros; …МФО only with uz_mfo (onec §8.19)', () => {
    // onec §8.19: the format has ПлательщикБИК (9) and no МФО field; which one the UZ edition reads is unverified.
    const parsed = parseBankExchange(buildBankExchange(file()));
    const incoming = parsed.documents[0]!;
    assert.equal(incoming['ПлательщикБИК'], '00083');
    assert.equal(incoming['ПолучательБИК'], '00444');
    assert.equal(incoming['ПлательщикМФО'], undefined);
    const uz = parseBankExchange(buildBankExchange({ ...file(), bankKeys: 'uz_mfo' })).documents[0]!;
    assert.deepEqual([uz['ПлательщикБИК'], uz['ПлательщикМФО']], ['00083', '00083']);
    assert.equal(incoming['ДатаПоступило'], '01.10.2026');
    assert.equal(parsed.documents[1]?.['ДатаСписано'], '02.10.2026');
  });

  it('(РасчСчет, вид, Дата, Номер) is unique in the file: a repeated number on one day is told apart (onec §8.20)', () => {
    // onec §8.20 / bank §7.44 (iBank2 rule): «по одному расчетному счету не может быть нескольких … документов одного вида за одну дату с одинаковыми номерами».
    const parsed = parseBankExchange(buildBankExchange(file()));
    const keys = parsed.documents.map((d) => `${owner.account}|${d._type}|${d['Дата']}|${d['Номер']}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.deepEqual(parsed.documents.map((d) => d['Номер']), ['101', '57', '58', '58/2', '58'], 'the same number on another day stays');
    assert.deepEqual(parsed.documents.map((d) => d['Сумма']), ['15000000.00', '3200000.00', '1000.50', '2000.00', '3000.00'], 'no payment lost');
  });
});

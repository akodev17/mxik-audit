// Statement values as banks write them: amounts, dates, ИНН / accounts / МФО, debit-credit flags.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { datesIn, fromSerial, readDate } from './dates.js';
import { addDecimals, formatDecimal, readDecimal, subDecimals, toUnits, fromUnits } from './decimal.js';
import { accountCurrency, normalizeName, readAccount, readDirectionFlag, readInn, readMfo } from './identifiers.js';

const v = (raw: string, mark?: 'auto' | 'comma' | 'dot'): string | null => readDecimal(raw, mark).value;

describe('readDecimal', () => {
  it('reads grouped amounts with either decimal mark', () => {
    assert.equal(v('1 234 567,89'), '1234567.89');
    assert.equal(v('1 234 567,89'), '1234567.89', 'no-break space grouping (Excel)');
    assert.equal(v('1 234,5'), '1234.5', 'narrow no-break space');
    assert.equal(v("1'234'567.89"), '1234567.89', 'apostrophe grouping');
    assert.equal(v('1,234,567.89'), '1234567.89');
    assert.equal(v('1.234.567,89'), '1234567.89');
    assert.equal(v('1234567.89'), '1234567.89');
    assert.equal(v('1234567,89'), '1234567.89');
    assert.equal(v('0,00'), '0');
    assert.equal(v('12 500 000,00'), '12500000');
  });

  it('reads signs, parentheses and currency words', () => {
    assert.equal(v('-750 000,50'), '-750000.5');
    assert.equal(v('(1 000,00)'), '-1000');
    assert.equal(v('1 000,00-'), '-1000');
    assert.equal(v('−45,10'), '-45.1', 'minus sign U+2212');
    assert.equal(v('1 500 000 сум'), '1500000');
    assert.equal(v("250 000 so'm"), '250000');
    assert.equal(v('UZS 99.99'), '99.99');
  });

  it('flags a lone three-digit group as ambiguous and reads it as thousands', () => {
    assert.deepEqual(readDecimal('12,500'), { value: '12500', invalid: false, ambiguous: true });
    assert.deepEqual(readDecimal('12,500', 'comma'), { value: '12.5', invalid: false, ambiguous: false });
    assert.equal(v('1234.567'), '1234.567', 'a 4-digit whole part is not grouping');
  });

  it('a number cell ("1234567.89") reads right under an explicit comma convention', () => {
    assert.equal(v('1234567.89', 'comma'), '1234567.89');
    assert.equal(v('1.234.567,89', 'comma'), '1234567.89');
    assert.equal(v('1234,5', 'dot'), '1234.5');
  });

  it('refuses text that is not a number, and keeps empty cells empty', () => {
    assert.deepEqual(readDecimal('1,2,3'), { value: null, invalid: true, ambiguous: false });
    assert.deepEqual(readDecimal('abc'), { value: null, invalid: true, ambiguous: false });
    assert.deepEqual(readDecimal('1.2.3'), { value: null, invalid: true, ambiguous: false });
    assert.deepEqual(readDecimal(''), { value: null, invalid: false, ambiguous: false });
    assert.deepEqual(readDecimal('—'), { value: null, invalid: false, ambiguous: false });
    assert.equal(readDecimal('1.1234567').invalid, true, 'more than six fraction digits');
  });

  it('adds exactly (no floating point drift)', () => {
    assert.equal(addDecimals('0.1', '0.2'), '0.3');
    assert.equal(addDecimals('15000000', '22184567.89'), '37184567.89');
    assert.equal(subDecimals('37184567.89', '12779221.89'), '24405346');
    assert.equal(fromUnits(toUnits('-0.000001')), '-0.000001');
    assert.equal(formatDecimal('1234567.8'), '1 234 567.80');
    assert.equal(formatDecimal('-5', ' ', ','), '-5,00');
  });
});

describe('readDate', () => {
  it('reads the formats statements use', () => {
    assert.equal(readDate('01.10.2026').value, '2026-10-01');
    assert.equal(readDate('1/10/26').value, '2026-10-01');
    assert.equal(readDate('2026-10-01').value, '2026-10-01');
    assert.equal(readDate('01.10.2026 14:05:00').value, '2026-10-01', 'with a time');
    assert.equal(readDate('2026-10-01T09:00:00Z').value, '2026-10-01');
    assert.equal(readDate('05.10.2026г.').value, '2026-10-05');
    assert.equal(readDate('01/02/2026', 'mdy').value, '2026-01-02');
    assert.equal(readDate('01.02.2026', 'dmy').value, '2026-02-01');
  });

  it('reads Excel serial numbers (1900 system)', () => {
    assert.equal(readDate('46296').value, '2026-10-01');
    assert.equal(fromSerial(45658), '2025-01-01');
    assert.equal(readDate('46296.5').value, '2026-10-01', 'a serial with a time fraction');
  });

  it('refuses impossible dates and stray numbers', () => {
    assert.deepEqual(readDate('32.10.2026'), { value: null, invalid: true });
    assert.deepEqual(readDate('29.02.2026'), { value: null, invalid: true });
    assert.equal(readDate('29.02.2028').value, '2028-02-29');
    assert.deepEqual(readDate('12345'), { value: null, invalid: true }, 'outside 1990–2100');
    assert.deepEqual(readDate('Итого'), { value: null, invalid: true });
    assert.deepEqual(readDate(''), { value: null, invalid: false });
  });

  it('finds the dates of a period line', () => {
    assert.deepEqual(datesIn('за период с 01.10.2026 по 31.10.2026'), ['2026-10-01', '2026-10-31']);
  });
});

describe('identifiers', () => {
  it('ИНН and ПИНФЛ; zeros are "unknown"', () => {
    assert.deepEqual(readInn('302 345 678'), { value: '302345678', invalid: false, placeholder: false });
    assert.equal(readInn('31203851234567').value, '31203851234567');
    assert.deepEqual(readInn('000000000'), { value: null, invalid: false, placeholder: true });
    assert.deepEqual(readInn('12345'), { value: null, invalid: true, placeholder: false });
    assert.deepEqual(readInn(''), { value: null, invalid: false, placeholder: false });
  });

  it('accounts (20 digits, spaces allowed), МФО padded back to 5 digits', () => {
    assert.equal(readAccount('20208 000 9 00123456 001').value, '20208000900123456001');
    assert.equal(readAccount('2020800010').invalid, true);
    assert.equal(readMfo('440').value, '00440', 'Excel dropped the leading zeros of a number cell');
    assert.equal(readMfo('00014').value, '00014');
    // Review 30 Oct (R-B18): a number cell written with its decimal part; the dot was dropped and '444.0' became 04440.
    assert.equal(readMfo('444.0').value, '00444');
    assert.equal(readInn('302345678.0').value, '302345678');
    assert.equal(readMfo('4.440').invalid, false, 'a dot inside the digits is still a separator');
    assert.equal(readMfo('1234567').invalid, true);
    assert.equal(accountCurrency('20208000900123456001'), 'UZS');
    assert.equal(accountCurrency('20208840900123456001'), 'USD');
    assert.equal(accountCurrency('20208999900123456001'), null);
  });

  it('names compare without quotes and legal forms', () => {
    assert.equal(normalizeName('ООО «Альфа Трейд»'), 'альфа трейд');
    assert.equal(normalizeName('"ALFA TREYD" MChJ'), 'alfa treyd');
    assert.equal(normalizeName('OOO "Omad" '), 'ooo omad', 'a Latin "OOO" is not a known form word and stays');
  });

  it('debit / credit flags in both languages', () => {
    for (const d of ['Д', 'Дт', 'D', 'Debet', 'Расход', 'chiqim', '-']) assert.equal(readDirectionFlag(d), 'debit', d);
    for (const c of ['К', 'Кт', 'C', 'K', 'Kredit', 'Приход', 'kirim', '+']) assert.equal(readDirectionFlag(c), 'credit', c);
    assert.equal(readDirectionFlag('X'), null);
  });
});

// Pure parts of the Didox workflow: decimals, name folding, the document parser on the fixtures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { multiply, normalizeDecimal, percentOf, readDecimal, roundTo, toDecimalString } from './decimal.js';
import { canonicalJson, detectKind, isoDate, lowerKeys, parseDidoxDocument, SHAPE_VERIFIED, unwrap } from './document.js';
import { FIXTURE_DIR } from './fake-server.js';
import { duplicateNameGroups, foldName } from './fold.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
const parse = (name: string) => {
  const r = parseDidoxDocument(fixture(name), { source: 'didox_json' });
  assert.ok(r.ok, `${name}: ${JSON.stringify(r)}`);
  return r.invoice;
};

describe('decimal', () => {
  it('reads numbers, strings, commas, spaces and noisy floats without float arithmetic', () => {
    assert.equal(normalizeDecimal(892.8600000000000136), '892.86');
    assert.equal(normalizeDecimal('892.8600000000000136'), '892.86');
    assert.equal(normalizeDecimal(0.1 + 0.2), '0.3');
    assert.equal(normalizeDecimal('21428,64'), '21428.64');
    assert.equal(normalizeDecimal('485 000'), '485000');
    assert.equal(normalizeDecimal('1,234,567.5'), '1234567.5');
    // Review 30 Oct (R-D9): with both marks the last one is the decimal mark ("1.234,56" was 1.23456).
    assert.equal(normalizeDecimal('1.234,56'), '1234.56');
    assert.equal(normalizeDecimal('1.234.567,5'), '1234567.5');
    assert.equal(normalizeDecimal(1e-7), '0');
    assert.equal(normalizeDecimal('-12.0000005'), '-12.000001');
    assert.equal(normalizeDecimal(12345678901234), '12345678901234');
    for (const bad of ['', 'abc', null, undefined, NaN, Infinity, '1.2.3', {}]) assert.equal(normalizeDecimal(bad), null, JSON.stringify(bad) ?? 'undefined');
  });

  it('multiplies and takes percentages on integers of millionths', () => {
    const q = readDecimal('1.5') ?? 0n;
    const p = readDecimal('9850000') ?? 0n;
    assert.equal(toDecimalString(multiply(q, p)), '14775000');
    assert.equal(toDecimalString(percentOf(readDecimal('21428.64') ?? 0n, 12_000_000n)), '2571.4368');
    assert.equal(toDecimalString(roundTo(readDecimal('2571.4368') ?? 0n, 2)), '2571.44');
    // The classic float trap: 0.1 × 3 is exactly 0.3 here.
    assert.equal(toDecimalString(multiply(readDecimal('0.1') ?? 0n, 3_000_000n)), '0.3');
  });
});

describe('foldName', () => {
  it('folds case, punctuation, double spaces, hyphens and glued units into one key', () => {
    assert.equal(foldName('Цемент М400 50кг'), foldName('ЦЕМЕНТ  М-400, 50 кг'));
    assert.equal(foldName('Цемент M400 50 kg'), foldName('Цемент М400 50кг'), 'Latin M and kg');
  });

  it('folds ё/е and Latin look-alikes in Cyrillic words', () => {
    assert.equal(foldName('Чай зелёный 100г'), foldName('ЧАЙ ЗЕЛЕНЫЙ 100 г'));
    assert.equal(foldName('Кабель BBГ 3x2.5'), foldName('Кабель ВВГ 3х2,5'));
  });

  it('drops a count unit appended to the name, keeps measurements', () => {
    assert.equal(foldName('Болт М8 шт'), foldName('Болт М8'));
    assert.equal(foldName('Болт М8 (шт.)'), foldName('Болт М8'));
    assert.notEqual(foldName('Цемент М400 50кг'), foldName('Цемент М400 25кг'));
    assert.notEqual(foldName('Масло 1л'), foldName('Масло 5л'));
  });

  it('groups duplicate spellings of one product inside an invoice', () => {
    const groups = duplicateNameGroups(['Цемент М400 50кг', 'Арматура', 'ЦЕМЕНТ  М-400, 50 кг', 'арматура.']);
    assert.deepEqual([...groups.values()], [[0, 2], [1, 3]]);
  });
});

describe('Didox document parser', () => {
  it('is marked unverified against Didox', () => {
    assert.equal(SHAPE_VERIFIED, false);
  });

  it('standard ЭСФ: header, three lines, totals, VAT 12 %', () => {
    const inv = parse('invoice-standard-3.json');
    assert.equal(inv.meta.number, 'EF-2026/0417');
    assert.equal(inv.meta.date, '2026-10-14');
    assert.equal(inv.meta.contractNumber, 'Д-17/2026');
    assert.equal(inv.meta.seller.inn, '302345678');
    assert.equal(inv.meta.seller.account, '20208000900123456001');
    assert.equal(inv.meta.seller.mfo, '00440');
    assert.equal(inv.meta.buyer.inn, '305123456');
    assert.equal(inv.meta.externalId, '6a1f0c0e2b9d4c0012ab34cd');
    assert.equal(inv.lines.length, 3);
    const [cement, rebar] = inv.lines;
    assert.deepEqual([cement?.mxik, cement?.quantity, cement?.price, cement?.amount, cement?.vatRate, cement?.vatAmount, cement?.total], ['02523001001000000', '40', '62000', '2480000', '12', '297600', '2777600']);
    assert.equal(rebar?.quantity, '1.5');
    assert.equal(inv.meta.totalAmount, '20155000');
    assert.equal(inv.meta.totalVat, '2418600');
    assert.equal(inv.meta.totalWithVat, '22573600');
    assert.deepEqual(inv.lines.flatMap((l) => l.issues), []);
    assert.match(inv.fingerprint, /^[0-9a-f]{64}$/);
  });

  it('120 lines in the upper-case form read like the lower-case one', () => {
    const inv = parse('invoice-120-lines.json');
    assert.equal(inv.lines.length, 120);
    assert.equal(inv.meta.number, 'TT-120/26');
    assert.equal(inv.meta.seller.inn, '307654321');
    assert.equal(inv.lines[0]?.measureId, '38');
    assert.equal(inv.lines[3]?.name, 'Цемент М400 50кг');
    assert.equal(foldName(inv.lines[3]?.name ?? ''), foldName(inv.lines[7]?.name ?? ''));
    assert.deepEqual(inv.lines.flatMap((l) => l.issues), []);
  });

  it('measure ids map to Didox unit names when the list is given', () => {
    const r = parseDidoxDocument(fixture('invoice-120-lines.json'), { source: 'didox_api', measures: new Map([['38', 'упаковка'], ['1', 'штук']]) });
    assert.ok(r.ok);
    assert.equal(r.invoice.lines[0]?.unit, 'упаковка');
    assert.equal(r.invoice.lines[1]?.unit, 'штук');
  });

  it('noisy floats, strings and broken codes; wrapped in { data } like an API answer', () => {
    const inv = parse('invoice-noisy.json');
    assert.equal(inv.meta.number, '№ 88');
    assert.equal(inv.meta.date, '2026-10-14', 'dd.mm.yyyy');
    assert.equal(inv.meta.seller.inn, '301112223', 'spaces in the TIN');
    assert.equal(inv.meta.seller.name, 'YaTT "Karimov Anvar"', 'flat sellername');
    assert.equal(inv.meta.externalId, '6a20aa11c0ffee0000000042');
    const [oil, sugar, flour, rice, tea] = inv.lines;
    assert.deepEqual([oil?.price, oil?.amount, oil?.vatAmount, oil?.total], ['892.86', '21428.64', '2571.4368', '24000.0768']);
    assert.equal(sugar?.price, '485000');
    assert.deepEqual(sugar?.issues.map((i) => i.code), ['mxik_missing']);
    assert.equal(flour?.quantity, '10');
    assert.deepEqual(flour?.issues.map((i) => [i.code, i.params?.['value']]), [['mxik_invalid', '1101001001000000']]);
    assert.deepEqual(rice?.issues.map((i) => i.code), ['mxik_missing']);
    assert.equal(rice?.price, '30000');
    // 50 × 12 500 = 625 000, the document says 650 000: kept as stated, flagged.
    assert.equal(tea?.amount, '650000');
    assert.deepEqual(tea?.issues.map((i) => [i.code, i.field, i.params?.['expected']]), [['totals_mismatch', 'amount', '625000']]);
  });

  it('VAT 0 and a 14-digit ПИНФЛ seller', () => {
    const inv = parse('invoice-vat0-pinfl.json');
    assert.equal(inv.meta.seller.inn, '31503820150012');
    assert.equal(inv.meta.seller.account, null);
    assert.deepEqual(inv.lines.map((l) => [l.vatRate, l.vatAmount, l.total]), [[null, '0', '4500000'], [null, '0', '510000']]);
    assert.equal(inv.meta.totalVat, '0');
    assert.equal(inv.meta.totalWithVat, '5010000');
  });

  it('refuses an act with its kind, and other non-invoices', () => {
    assert.deepEqual(parseDidoxDocument(fixture('act.json'), { source: 'didox_json' }), { ok: false, error: 'not_invoice', kind: 'act' });
    assert.equal(detectKind(lowerKeys({ ContractDoc: {}, Owner: 1, Parts: [] })), 'contract');
    assert.equal(detectKind({ verificationactdoc: {} }), 'reconciliation');
    assert.equal(detectKind({ document: {}, documentid: 'x' }), 'free_form');
    assert.deepEqual(parseDidoxDocument('{not json', { source: 'didox_json' }), { ok: false, error: 'unreadable', kind: 'unknown' });
    assert.equal((parseDidoxDocument({ hello: 1 }, { source: 'didox_json' }) as { error: string }).error, 'not_invoice');
  });

  it('refuses an invoice without number or date, or without lines', () => {
    const doc = fixture('invoice-standard-3.json') as Record<string, unknown>;
    const noDate = parseDidoxDocument({ ...doc, facturadoc: { facturano: '1' } }, { source: 'didox_json' });
    assert.deepEqual(noDate, { ok: false, error: 'missing_header', kind: 'invoice', detail: 'facturadoc.facturadate' });
    const noLines = parseDidoxDocument({ ...doc, productlist: { products: [] } }, { source: 'didox_json' });
    assert.equal((noLines as { error: string }).error, 'no_lines');
  });

  it('the fingerprint ignores key order and the wrapper', () => {
    const doc = fixture('invoice-standard-3.json') as Record<string, unknown>;
    const reordered = Object.fromEntries(Object.entries(doc).reverse());
    const a = parseDidoxDocument(doc, { source: 'didox_json' });
    const b = parseDidoxDocument({ data: reordered, status: 3 }, { source: 'didox_api', didoxId: 'X1' });
    assert.ok(a.ok && b.ok);
    assert.equal(a.invoice.fingerprint, b.invoice.fingerprint);
    assert.equal(b.invoice.meta.externalId, 'X1', 'the Didox id wins over facturaid');
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('unwraps a document held as a JSON string', () => {
    const doc = fixture('invoice-standard-3.json');
    const { kind, doc: inner } = unwrap({ _id: 'abc', json: JSON.stringify(doc) });
    assert.equal(kind, 'invoice');
    assert.ok(inner && 'facturadoc' in inner);
  });

  it('dates: ISO, dd.mm.yyyy, epoch ms (Tashkent), invalid', () => {
    assert.equal(isoDate('2026-10-01T00:00:00'), '2026-10-01');
    assert.equal(isoDate('01.10.2026'), '2026-10-01');
    assert.equal(isoDate(Date.UTC(2026, 9, 31, 20)), '2026-11-01');
    assert.equal(isoDate('31.02.2026'), null);
    assert.equal(isoDate(''), null);
  });

  it('status "3" (source A: signed) reads as signed, others not', () => {
    const doc = fixture('invoice-standard-3.json');
    const signed = parseDidoxDocument(doc, { source: 'didox_api', didoxStatus: '3' });
    const sent = parseDidoxDocument(doc, { source: 'didox_api', didoxStatus: '1' });
    assert.ok(signed.ok && sent.ok);
    assert.equal(signed.invoice.meta.signed, true);
    assert.equal(sent.invoice.meta.signed, false);
  });
});

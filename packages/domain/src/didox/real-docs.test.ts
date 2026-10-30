// The parser and the rules on real-world Didox material (fixtures/SOURCES.md): the one real export
// ZIP, Didox's official examples 02–17, the 1C_integration cases and documented tolerances. No
// database. Each case names the research checklist item it covers (RESEARCH.md §7.n).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import ExcelJS from 'exceljs';
import { DidoxClient, RateLimiter } from './client.js';
import { listTotalsOf } from './connection.js';
import { fractionDigits } from './decimal.js';
import { parseDidoxDocument, parseDidoxJson, statusInfo, type ParsedInvoice } from './document.js';
import { FIXTURE_DIR } from './fake-server.js';
import type { MirrorFact } from './mirror.js';
import { invoiceRules, unitIdOf, vatRatesOn, type RuleContext } from './rules.js';
import { esfTemplateRows, readDidoxUpload, sheetSignature, templateToDocuments } from './sources.js';

const REAL = join(FIXTURE_DIR, 'real');
const real = (name: string): unknown => JSON.parse(readFileSync(join(REAL, name), 'utf8'));
const ok = (input: unknown, options: Partial<Parameters<typeof parseDidoxDocument>[1]> = {}): ParsedInvoice => {
  const r = parseDidoxDocument(input, { source: 'didox_json', ...options });
  assert.ok(r.ok, JSON.stringify(r));
  return r.invoice;
};
const codes = (issues: ReadonlyArray<{ code: string }>): string[] => issues.map((i) => i.code);
const TODAY = '2026-10-30';

/** A mirror fact with defaults: an existing, active, strict-unit code. */
const fact = (code: string, over: Partial<MirrorFact> = {}): MirrorFact => ({
  code, exists: true, retiredAt: null, unitIds: [1], unitCanonical: ['dona'], unitBinding: 'strict', isMarked: false,
  privilegeIds: [], restrictedFrom: null, packages: null, apiActive: null, ...over,
});
const facts = (...list: MirrorFact[]): RuleContext['facts'] => new Map(list.map((f) => [f.code, f]));

describe('Didox real export ZIP (the one real document found)', () => {
  // didox §7.14: a single-document zip — <DOCID>.json + <DOCID>.pdf + readme.txt, nothing else read.
  it('reads the zip: one invoice, its print form beside it, the readme ignored', async () => {
    const read = await readDidoxUpload(readFileSync(join(REAL, 'real-export-1428.zip')), '05_03_2026_200242936301467485_Хисоб_фактура_1428_от_30_06_2025_1772684278.zip');
    assert.equal(read.kind, 'documents');
    if (read.kind !== 'documents') return;
    assert.deepEqual(read.skipped, []);
    assert.equal(read.documents.length, 1);
    const [doc] = read.documents;
    assert.equal(doc?.entry, '05EDC0F656A811F0B9D2FA163E666D9A.json');
    assert.equal(doc?.kind, 'invoice');
    assert.equal(doc?.pdf?.subarray(0, 5).toString('latin1'), '%PDF-');
  });

  // didox §7.1, §7.3, §7.5, §7.6: lowercase keys, ordno "1", packagecode "1494642", measureid null, vatregstatus "20".
  it('parses the real ЭСФ №1428: header, parties, the bank-service line, totals from the lines', () => {
    const inv = ok(real('01-real-export-1428.json'), { source: 'didox_zip' });
    assert.deepEqual([inv.meta.number, inv.meta.date, inv.meta.contractNumber, inv.meta.contractDate], ['1428', '2025-06-30', 'BC177966', '2023-02-15']);
    assert.deepEqual(inv.meta.seller, { name: '"CHET EL KAPITALI ISHTIROKIDAGI "HAMKORBANK" ATB', inn: '200242936', account: '22510000500000083006', mfo: '00083', counterpartyId: null });
    assert.equal(inv.meta.buyer.inn, '301467485');
    assert.equal(inv.meta.currency, 'UZS');
    assert.equal(inv.facturaId, '68636ebd7dc738171cf68510');
    assert.equal(inv.docType, '002');
    assert.equal(inv.envelope, 'bare');
    assert.equal(inv.parties.seller.vatRegStatus, '20');
    const [line] = inv.lines;
    assert.deepEqual(
      [line?.lineNo, line?.mxik, line?.packageCode, line?.packageName, line?.measureId, line?.quantity, line?.price, line?.amount, line?.vatRate, line?.vatAmount, line?.total, line?.didox.origin],
      [1, '10403003014000001', '1494642', 'услуга (сум)', null, '1', '892.86', '892.86', '12', '107.14', '1000', 3],
    );
    assert.deepEqual(line?.issues, []);
    assert.deepEqual([inv.meta.totalAmount, inv.meta.totalVat, inv.meta.totalWithVat, inv.totalsFrom], ['892.86', '107.14', '1000', 'lines']);
    // §7.21–27 on the real document: nothing to flag (service code, origin 3, 12 % in 2025, parties well-formed).
    const ruled = invoiceRules(inv, { today: TODAY, facts: facts(fact('10403003014000001', { unitIds: [25], unitCanonical: ['xizmat (soʻm)'] })) });
    assert.deepEqual(ruled.lines, [[]]);
    assert.deepEqual(ruled.document, []);
  });
});

describe('Didox official examples (api-docs.didox.uz)', () => {
  // didox §7.1, §7.24: the PascalCase create body, a committent and a VAT privilege at 0 %.
  it('02: PascalCase 002 with a committent and a privilege line', () => {
    const inv = ok(real('02-factura-full.json'));
    assert.deepEqual([inv.meta.number, inv.meta.date, inv.meta.seller.inn, inv.meta.buyer.inn], ['SF-0000001', '2026-08-04', '310529901', '302936161']);
    const [line] = inv.lines;
    assert.deepEqual(line?.didox.lgota, { id: '100001', type: 1, name: '(ст.263 НК) пункт 1. услуг по международной перевозке товаров...', vatSum: '1200000' });
    assert.deepEqual(line?.didox.committent, { name: '"GAMMA TRADE" LTD', tin: '300555666' });
    assert.deepEqual([line?.vatRate, line?.vatAmount, line?.total], ['0', '0', '10000000']);
    assert.deepEqual(inv.flags, { hasVat: true, hasExcise: false, hasCommittent: true, hasLgota: true, hasMarking: false, hasMedical: null });
    // LgotaVatSum = 12 % of DeliverySum (V8): no privilege finding; HasVat true while every line is 0 % is the docs' own example.
    const ruled = invoiceRules(inv, { today: TODAY });
    assert.ok(!ruled.lines[0]?.some((i) => i.code.startsWith('lgota')), JSON.stringify(ruled.lines[0]));
    assert.deepEqual(codes(ruled.document), ['flag_mismatch']);
  });

  // didox §7.7, §7.9: a one-sided ЭСФ — Buyer null, BuyerTin "", SingleSidedType; empty optional blocks are absent.
  it('03 on 02: a one-sided invoice reads without a buyer, and empty optional blocks count as absent', () => {
    const doc = { ...(real('02-factura-full.json') as Record<string, unknown>), ...(real('03-onesided-blocks.json') as Record<string, unknown>) };
    const inv = ok(doc);
    assert.equal(inv.singleSidedType, 1);
    assert.deepEqual(inv.meta.buyer, { name: '', inn: null, account: null, mfo: null, counterpartyId: null });
    assert.equal(inv.oldFactura, null, 'OldFacturaDoc of empty strings');
    const ruled = invoiceRules(inv, { today: TODAY });
    assert.ok(codes(ruled.document).includes('one_sided'));
    assert.ok(!codes(ruled.document).includes('buyer_missing'));
  });

  // didox §7.2: the create answer's pending_document.document_json; §7.5 packagecode as a number.
  it('04 and 15: the create envelope, with the Didox id from the wrapper', () => {
    const full = ok(real('04-create-pending-document.json'));
    assert.equal(full.envelope, 'create');
    assert.equal(full.meta.number, 'SF-0000001');
    const minimal = ok(real('15-create-minimal.json'));
    assert.equal(minimal.envelope, 'create');
    assert.equal(minimal.meta.externalId, '11f092e3428d10c68f7b1e0008000075');
    assert.equal(minimal.lines[0]?.packageCode, '1505731');
    assert.equal(minimal.meta.seller.inn, '310529901', 'no seller block: the TIN comes from sellertin');
  });

  // didox §7.2, §7.12, §7.13: GET /v1/documents/{id} — data.json + data.document, the signature string parsed twice.
  it('05: the GET envelope — status, signers and Didox\'s comment from data.document', () => {
    const inv = ok(real('05-get-document.json'), { source: 'didox_api' });
    assert.equal(inv.envelope, 'get');
    assert.equal(inv.meta.externalId, '11F092E3428D10C68F7B1E0008000075');
    assert.deepEqual([inv.meta.didoxStatus, inv.meta.signed], ['3', true]);
    assert.deepEqual(inv.signers, [{ taxId: '310529901', name: 'DIREKTOR F.I.O.', signedAt: '2025-09-16T14:55:23+05:00' }]);
    assert.equal(inv.statusComment, 'Документ отменен');
    assert.equal(inv.facturaType, '0');
    const [line] = inv.lines;
    assert.deepEqual([line?.packageCode, line?.measureId, line?.vatAmount, line?.total, line?.didox.pharm], ['1505731', null, '0.12', '1.12', null]);
    // §7.31: the docs' own example is dated before its contract.
    const ruled = invoiceRules(inv, { today: TODAY });
    assert.ok(codes(ruled.document).includes('date_before_contract'), JSON.stringify(ruled.document));
  });

  // didox §7.15: pharm fields only when hasmedical.
  it('06: ФАРМ 008 carries series, base price, mark-up and dispensing per line', () => {
    const inv = ok(real('06-pharm-008.json'));
    assert.equal(inv.docType, '008');
    assert.deepEqual(inv.lines[0]?.didox.pharm, { serial: 'SER-000123', baseSumma: '80000', profitRate: '25', dispenseType: 2 });
    assert.equal(inv.lines[0]?.mxik, '02100000000000001', 'the leading zero survives');
  });

  // didox §7.16: the hybrid's own shape (Roadway.ProductGroups[].ProductInfo, Amount/Price/Vat{Rate,Sum}); totals from the document (B6).
  it('07: a hybrid 023 reads as an invoice, its totals from the product group', () => {
    const inv = ok(real('07-hybrid-023.json'));
    assert.equal(inv.docType, '023');
    assert.deepEqual([inv.meta.number, inv.meta.date, inv.meta.seller.inn, inv.meta.seller.mfo, inv.meta.buyer.inn], ['тест', '2025-10-20', '302936161', '00974', '310529901']);
    assert.equal(inv.facturaType, '4');
    const [line] = inv.lines;
    assert.deepEqual([line?.mxik, line?.packageCode, line?.quantity, line?.price, line?.amount, line?.vatRate, line?.vatAmount, line?.total], ['08471001001000000', '1501886', '1', '1', '1', '12', '0.12', '1.12']);
    assert.equal(inv.totalsFrom, 'document');
    assert.deepEqual(inv.statedTotals, { amount: '1', vat: '0.12', withVat: '1.12' });
    assert.deepEqual(inv.documentIssues, []);
  });

  // didox §7.16, §1.4: acts (005), powers of attorney (006) and waybills (041) are recognised and refused with their kind.
  it('08, 09, 10: act, empowerment and waybill are not invoices', () => {
    for (const [file, kind] of [['08-act-005.json', 'act'], ['09-empowerment-006.json', 'empowerment'], ['10-ttn-041.json', 'waybill']] as const) {
      assert.deepEqual(parseDidoxDocument(real(file), { source: 'didox_json' }), { ok: false, error: 'not_invoice', kind }, file);
    }
  });

  // didox §7.2, §7.5, §7.6: the 2020 roaming wrapper, BuyerTin as a number, MeasureId as an int, no CatalogCode.
  it('17: the 2020 {"Factura":…} document', () => {
    const inv = ok(real('17-factura-2020.json'));
    assert.equal(inv.envelope, 'factura_2020');
    assert.deepEqual([inv.meta.number, inv.meta.buyer.inn, inv.lines[0]?.measureId, inv.lines[0]?.didox.withoutVat], ['IER-BS09/4S', '302654054', '1', true]);
    // The paste itself is inconsistent: Count 0 and DeliverySumWithVat "0" beside DeliverySum 25000.
    assert.deepEqual(codes(inv.lines[0]?.issues ?? []), ['mxik_missing', 'totals_mismatch', 'quantity_invalid']);
  });

  // didox §7.11, §7.21, §1.3: the v2 list as documented — doc_id, roaming_id, next_page_url; total_sum is not the total.
  it('11 and 12: the documented list answers, read by the client', async () => {
    const answers = [real('11-list-v2.json'), real('12-list-v2-status60.json')];
    let call = 0;
    const fetchStub = (() => Promise.resolve(new Response(JSON.stringify(answers[call++]), { status: 200, headers: { 'Content-Type': 'application/json' } }))) as typeof fetch;
    const client = new DidoxClient({ baseUrl: 'http://didox.test', auth: { kind: 'user', userToken: 't' }, fetch: fetchStub, limiter: new RateLimiter(0), sleep: () => Promise.resolve() });
    const first = await client.listPage({ owner: 1, page: 1, limit: 20 });
    assert.deepEqual([first.entries[0]?.id, first.entries[0]?.roamingId, first.entries[0]?.status, first.total, first.nextPageUrl], ['11EFBD20AB80D1B080B2C6808E0C7050', '676292c40b3f6b873039e5ec', '1', 1, null]);
    assert.deepEqual(listTotalsOf(first.entries[0]!), { amount: '3950', vat: '474', withVat: '4424' });
    const second = await client.listPage({ owner: 0, doctype: '002,008,001', status: 60, page: 1, limit: 10 });
    assert.equal(second.total, 137);
    assert.equal(second.nextPageUrl, 'v2/documents?doctype=002%2C008%2C001&limit=10&owner=0&page=2&status=60');
    assert.equal(statusInfo('002', second.entries[0]?.status ?? '').state, 'agent');
  });
});

describe('1C_integration cases (Didox\'s own 1C library rules)', () => {
  const cases = real('1c-integration-cases.json') as { base: Record<string, unknown>; cases: Record<string, unknown[]>; overrides: Record<string, Record<string, unknown>> };
  const doc = (products: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({ ...cases.base, productlist: { hasvat: true, products }, ...over });
  // The 1C library's test lines carry no ИКПУ; only the arithmetic is compared here.
  const arithmetic = (inv: ParsedInvoice): ParsedInvoice['lines'][number]['issues'][] => inv.lines.map((l) => l.issues.filter((i) => i.code !== 'mxik_missing'));

  // didox §7.4: float noise and numbers as strings fold to two decimals in tiyin, no mismatch.
  it('float noise, strings and a text VAT rate give the clean figures', () => {
    const inv = ok(doc(cases.cases['float_noise'] ?? []));
    assert.deepEqual(arithmetic(inv), [[]]);
    assert.deepEqual([inv.lines[0]?.price, inv.lines[0]?.amount, inv.meta.totalWithVat], ['892.86', '892.86', '1000']);
    const bank = ok(doc(cases.cases['bank_service'] ?? []));
    assert.equal(bank.lines[0]?.name, 'Услуга', '§7.8: the tab after the name');
  });

  // didox §7.21: amount, VAT and total each checked in tiyin; only the broken line and field are named.
  it('names the line whose amount, VAT or total does not add up, and no other', () => {
    const inv = ok(doc(cases.cases['bad_lines'] ?? []));
    assert.deepEqual(arithmetic(inv).map((l) => l.map((i) => [i.code, i.field])), [[], [['totals_mismatch', 'amount']], [['totals_mismatch', 'vatAmount']], [['totals_mismatch', 'total']]]);
    assert.deepEqual(arithmetic(inv)[1]?.[0]?.params, { stated: '350', expected: '300' });
  });

  // didox §7.21, V5/V6: a price rounded to two decimals may be off by half a tiyin per unit.
  it('allows half a tiyin per unit for a rounded price', () => {
    assert.deepEqual(arithmetic(ok(doc(cases.cases['half_tiyin_per_unit'] ?? []))), [[]]);
  });

  // didox §7.22, V7: withoutvat, or VAT 0 with total = amount, is a no-VAT line whatever rate is printed.
  it('reads a line without VAT as such, whatever rate is printed', () => {
    const inv = ok(doc(cases.cases['without_vat'] ?? []));
    assert.deepEqual(inv.lines.map((l) => [l.vatRate, l.vatAmount, l.total, l.didox.withoutVat, l.didox.vatRateStated]), [[null, '0', '100', true, '12'], [null, '0', '100', true, '12']]);
    assert.deepEqual(arithmetic(inv), [[], []]);
  });

  // didox §7.22: 15 % was the rate of 10.2019–2022; on a 2026 invoice it is flagged, 12 % is not.
  it('a VAT rate not in force on the invoice date is flagged', () => {
    const inv = ok(doc(cases.cases['rate_15'] ?? []));
    assert.deepEqual(arithmetic(inv), [[]]);
    const ruled = invoiceRules(inv, { today: TODAY });
    assert.deepEqual(ruled.lines[0]?.map((i) => [i.code, i.params?.['expected']]), [['vat_rate_unexpected', '0, 12']]);
    assert.deepEqual([vatRatesOn('2022-12-31'), vatRatesOn('2023-01-01'), vatRatesOn('2026-07-01')], [[0, 15], [0, 12], [0, 12, 6]]);
  });

  // didox §7.10, §7.29, §7.26: a type-8 correction names its original; a 14-digit ПИНФЛ seller is a valid TIN.
  it('a corrective type 8 with its old invoice, and a ПИНФЛ seller', () => {
    const corrective = ok(doc(cases.cases['bank_service'] ?? [], cases.overrides['corrective_type_8']));
    assert.equal(corrective.facturaType, '8');
    assert.deepEqual(corrective.oldFactura, { id: null, number: '20', date: '2025-12-01' });
    assert.deepEqual(codes(invoiceRules(corrective, { today: TODAY, original: null }).document), ['correction_original_unknown']);
    assert.deepEqual(codes(invoiceRules(corrective, { today: TODAY, original: { number: '20', date: '2025-12-01', sellerInn: '312318957' } }).document), []);
    const pinfl = ok(doc(cases.cases['bank_service'] ?? [], cases.overrides['pinfl_seller']));
    assert.equal(pinfl.meta.seller.inn, '30000000000099');
    assert.deepEqual(pinfl.documentIssues, []);
  });
});

describe('Didox numbers, codes and tolerances (documented rules)', () => {
  const base = (products: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> => ({
    facturadoc: { facturano: 'T-1', facturadate: '2026-10-01' }, sellertin: '310529901', seller: { name: 'X' }, buyertin: '302936161', buyer: { name: 'Y' },
    productlist: { hasvat: true, products }, ...over,
  });

  // didox §7.21: 3 × 33.33 = 99.99 against 100.00 is within 1.5 tiyin; a 3-decimal price gets one tiyin only; VAT 2 tiyin off is named.
  it('tiyin tolerances: per-unit rounding, three-decimal prices, VAT and header totals', () => {
    const inv = ok(base([
      { ordno: 1, name: 'a', catalogcode: '02523001001000000', count: 3, summa: '33.33', deliverysum: '100.00', vatrate: 12, vatsum: '12.00', deliverysumwithvat: '112.00' },
      { ordno: 2, name: 'b', catalogcode: '02523001001000000', count: 3, summa: '33.333', deliverysum: '100.02', vatrate: 12, vatsum: '12.00', deliverysumwithvat: '112.02' },
      { ordno: 3, name: 'c', catalogcode: '02523001001000000', count: 1, summa: '100', deliverysum: '100', vatrate: 12, vatsum: '12.02', deliverysumwithvat: '112.02' },
    ]), { listTotals: { amount: '300.02', vat: '36.02', withVat: '336.10' } });
    assert.deepEqual(inv.lines.map((l) => l.issues.map((i) => `${i.code}:${i.field}`)), [[], ['totals_mismatch:amount'], ['totals_mismatch:vatAmount']]);
    // B6: the header totals are the list's, and the lines' sum is compared with them (only the with-VAT total is off, by 6 tiyin).
    assert.deepEqual([inv.totalsFrom, inv.meta.totalAmount, inv.meta.totalWithVat], ['list', '300.02', '336.1']);
    assert.deepEqual(inv.documentIssues.map((i) => [i.code, i.field, i.params?.['lines']]), [['header_totals_mismatch', 'totalWithVat', '336.04']]);
  });

  // didox §7.21 (review 30 Oct, R-D8): |count × summa − deliverysum| ≤ 0.5 tiyin × count, VAT and total ≤ 1 tiyin; the
  // check had a one-tiyin floor plus half a tiyin, so count 1 × 100.00 = 100.01 passed.
  it('tiyin tolerances at count 1 and below: the research formula', () => {
    const line = (count: string, summa: string, deliverysum: string, vatsum: string, total: string) =>
      ({ ordno: 1, name: 'a', catalogcode: '02523001001000000', count, summa, deliverysum, vatrate: 12, vatsum, deliverysumwithvat: total });
    const issues = (l: Record<string, unknown>) => ok(base([l])).lines[0]?.issues.map((i) => `${i.code}:${i.field}`) ?? [];
    assert.deepEqual(issues(line('1', '100.00', '100.01', '12.00', '112.01')), ['totals_mismatch:amount']);
    assert.deepEqual(issues(line('1', '100.00', '100.00', '12.00', '112.00')), []);
    assert.deepEqual(issues(line('0.001', '1000.55', '1.00', '0.12', '1.12')), [], 'a sub-tiyin product rounds to the tiyin');
    assert.deepEqual(issues(line('1', '100.00', '100.00', '12.01', '112.01')), [], 'VAT one tiyin off is allowed');
    assert.deepEqual(issues(line('1', '100.00', '100.00', '12.02', '112.02')), ['totals_mismatch:vatAmount']);
  });

  // didox §7.20, V5: count ≤ 6 decimals, money ≤ 2; dot separator only.
  it('decimal places and number format', () => {
    assert.deepEqual([fractionDigits(892.8600000000000136), fractionDigits('892.8600000000000136'), fractionDigits('892.8599999999999'), fractionDigits('10000000.00'), fractionDigits('0.1234567')], [2, 2, 2, 0, 7]);
    const inv = ok(base([{ ordno: 1, name: 'a', catalogcode: '02523001001000000', count: '1.1234567', summa: '10.123', deliverysum: '1 000,50', vatrate: 12, vatsum: '120.06', deliverysumwithvat: '1120.56' }]));
    const ruled = invoiceRules(inv, { today: TODAY });
    assert.deepEqual(ruled.lines[0]?.map((i) => `${i.code}:${i.field}`), ['decimals_exceeded:quantity', 'decimals_exceeded:price', 'number_format:amount']);
  });

  // didox §7.5, §7.17: 17-digit codes never pass through a JS number; a lost leading zero is proposed back when the mirror knows the code.
  it('codes: numeric catalogcode kept as written; a 16-digit code gets its leading zero back', () => {
    const parsed = parseDidoxJson('{"catalogcode": 10403003014000001, "CatalogCode": 02100000000000001, "count": 1.5}') as Record<string, unknown>;
    assert.deepEqual(parsed, { catalogcode: '10403003014000001', CatalogCode: '02100000000000001', count: 1.5 });
    const inv = ok(base([{ ordno: 1, name: 'a', catalogcode: '2523001001000000', count: 1, summa: 1, deliverysum: 1, vatrate: 12, vatsum: 0.12, deliverysumwithvat: 1.12 }]));
    assert.deepEqual(inv.lines[0]?.issues.map((i) => [i.code, i.suggestion]), [['mxik_invalid', '02523001001000000']]);
    const ruled = invoiceRules(inv, { today: TODAY, facts: facts(fact('02523001001000000')) });
    assert.deepEqual(ruled.lines[0]?.map((i) => [i.code, i.suggestion]), [['mxik_leading_zero', '02523001001000000']]);
  });
});

describe('Didox rules against the tasnif mirror and the parties (synthetic facts)', () => {
  const line = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ ordno: 1, name: 'Товар', catalogcode: '02523001001000000', packagename: 'шт.', count: 1, summa: 100, deliverysum: 100, vatrate: 12, vatsum: 12, deliverysumwithvat: 112, origin: 2, ...over });
  const inv = (lines: unknown[], over: Record<string, unknown> = {}): ParsedInvoice => ok({
    facturadoc: { facturano: 'R-1', facturadate: '2026-09-10' }, contractdoc: { contractno: '1', contractdate: '2026-01-01' },
    sellertin: '310529901', seller: { name: 'X', vatregcode: '326080220838', vatregstatus: 20, account: '20208000905656222001', bankid: '00401', director: 'D' },
    buyertin: '302936161', buyer: { name: 'Y', vatregcode: '326040002521', vatregstatus: 20, account: '20208000400308125001', bankid: '00974', director: 'D' },
    productlist: { hasvat: true, products: lines }, ...over,
  });

  // didox §7.17, V2: a retired code is still valid within 30 days of its notice; after that it is inactive.
  it('activity on the invoice date with the 30-day grace, and restrictions by their own date', () => {
    const doc = inv([line()]);
    const at = (f: MirrorFact): string[] => codes(invoiceRules(doc, { today: TODAY, facts: facts(f) }).lines[0] ?? []);
    assert.deepEqual(at(fact('02523001001000000', { retiredAt: '2026-08-20' })), ['mxik_retired_later'], '2026-09-10 is within 30 days of 2026-08-20');
    assert.deepEqual(at(fact('02523001001000000', { retiredAt: '2026-08-01' })), ['mxik_inactive']);
    assert.deepEqual(at(fact('02523001001000000', { exists: false })), ['mxik_not_found']);
    assert.deepEqual(at(fact('02523001001000000', { restrictedFrom: '2026-07-01' })), ['mxik_restricted']);
    assert.deepEqual(at(fact('02523001001000000', { restrictedFrom: '2026-12-01' })), ['mxik_restricted_later']);
  });

  // didox §7.18, V3: the package must be one of the code's; the unit it stands for must be bound to the code.
  it('package and unit bound to the code', () => {
    const doc = inv([line({ packagecode: '1500001' }), line({ ordno: 2, packagename: 'услуга (сум)', catalogcode: '10306002005000000', origin: 3 })]);
    const ruled = invoiceRules(doc, { today: TODAY, facts: facts(
      fact('02523001001000000', { packages: [{ code: '1661883', name: '6 шт (пэт бутылка)', unitId: 1 }] }),
      fact('10306002005000000', { unitIds: [1], unitCanonical: ['dona'] }),
    ) });
    assert.deepEqual(ruled.lines.map((l) => codes(l)), [['package_not_of_code'], ['unit_not_of_code']]);
    assert.deepEqual([unitIdOf('кубический метр'), unitIdOf('шт.'), unitIdOf('услуга (сум)'), unitIdOf('мешок')], [20, 1, 25, null]);
  });

  // didox §7.23, §7.27, §7.28: flags agree with the lines; services are origin 3; marked codes carry marks.
  it('flags, origin and marking', () => {
    const doc = inv([line({ origin: 3 }), line({ ordno: 2, lgotaid: '100001', lgotatype: 1, lgotaname: 'x', lgotavatsum: 12, vatrate: 0, vatsum: 0, deliverysumwithvat: 100 })], { hasmarking: true });
    const ruled = invoiceRules(doc, { today: TODAY, facts: facts(fact('02523001001000000', { isMarked: true })) });
    assert.deepEqual(ruled.lines.map((l) => codes(l)), [['origin_mismatch', 'marks_missing'], ['marks_missing']]);
    // hasmarking is stated and no line has marks; haslgota is not stated in this list, so it is not compared.
    assert.deepEqual(ruled.document.map((i) => i.params?.['flag']), ['hasmarking']);
  });

  // didox §7.26, V10: identifiers in their formats; a VAT status of 21/22 is a credit risk.
  it('parties: VAT status, VAT code, МФО with lost zeros, account, buyer TIN', () => {
    const doc = inv([line()], {
      seller: { name: 'X', vatregcode: '32608022083', vatregstatus: '22', account: '2020800090565622200', bankid: '401', director: 'D' },
      buyertin: '30293616',
    });
    const ruled = invoiceRules(doc, { today: TODAY });
    assert.deepEqual(ruled.document.map((i) => [i.code, i.suggestion]), [
      ['vat_reg_code_invalid', undefined], ['vat_status_inactive', undefined], ['mfo_invalid', '00401'], ['account_invalid', undefined], ['buyer_tin_invalid', undefined],
    ]);
    // Review 30 Oct (R-D10): a VAT payer (status 20) without its registration code; a non-payer without one is fine.
    const payer = inv([line()], { seller: { name: 'X', vatregstatus: '20', director: 'D' } });
    assert.deepEqual(invoiceRules(payer, { today: TODAY }).document.map((i) => [i.code, i.field]), [['vat_reg_code_missing', 'seller.vatRegCode']]);
    const nonPayer = inv([line()], { seller: { name: 'X', director: 'D' } });
    assert.deepEqual(invoiceRules(nonPayer, { today: TODAY }).document.map((i) => i.code), []);
  });

  // didox §7.31, §7.32, §7.13: a future date; a cancelled document named with Didox's comment; restricted lists (§7.25).
  it('document level: future date, a void Didox status, the not-creditable list', () => {
    const doc = inv([line()], { facturadoc: { facturano: 'R-2', facturadate: '2026-11-15' } });
    const voided = { ...doc, meta: { ...doc.meta, didoxStatus: '5555' }, statusComment: 'Документ отменен' };
    const ruled = invoiceRules(voided, { today: TODAY, lists: { notIncluded: new Set(['02523001001000000']), compensation: new Set() } });
    assert.deepEqual(ruled.document.map((i) => [i.code, i.params?.['comment']]), [['date_in_future', undefined], ['didox_status_void', 'Документ отменен']]);
    assert.deepEqual(codes(ruled.lines[0] ?? []), ['vat_not_creditable']);
    assert.deepEqual([statusInfo('002', '3').signed, statusInfo('031', '3').signed, statusInfo('023', '210').signed, statusInfo('002', '50').state], [true, null, null, 'annulled']);
  });
});

describe('Didox ЭСФ Excel template (official filling instruction, 73 columns)', () => {
  /** A template as the instruction describes it: captions in row 1, two invoices, header cells on each invoice's first line. */
  async function template(repeatA = false): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ЭСФ');
    const captions: Record<number, string> = {
      1: '№', 2: 'Тип СФ', 3: 'Тип односторонней СФ', 4: 'Номер СФ', 5: 'Дата СФ', 6: 'Номер договора', 7: 'Дата договора',
      13: 'Наименование поставщика', 14: 'ИНН поставщика', 27: 'Наименование покупателя', 28: 'ИНН покупателя',
      41: '№ п/п', 45: 'Наименование товара', 46: 'ИКПУ', 47: 'Штрих код', 49: 'Код единицы измерения', 52: 'Количество', 53: 'Цена',
      56: 'Стоимость поставки', 57: 'Ставка НДС', 58: 'Сумма НДС', 59: 'Стоимость с НДС', 60: 'Код льготы', 65: 'Происхождение', 73: 'Отпуск',
    };
    ws.addRow(Array.from({ length: 73 }, (_, i) => captions[i + 1] ?? `Поле ${i + 1}`));
    const row = (cells: Record<number, string | number>): void => { ws.addRow(Array.from({ length: 73 }, (_, i) => cells[i + 1] ?? null)); };
    row({ 1: 1, 2: 0, 4: 'EXL-1', 5: '15.10.2026', 6: 'D-7', 7: '01.01.2026', 13: '"ALFA" MCHJ', 14: '310529901', 27: '"BETA" MCHJ', 28: '302936161', 41: 1, 45: 'Ноутбук', 46: '08471001001000000', 49: '1501886', 52: 2, 53: 1000, 56: 2000, 57: 12, 58: 240, 59: 2240, 65: 2 });
    row({ ...(repeatA ? { 1: 1, 4: 'EXL-1' } : {}) as Record<number, string | number>, 41: 2, 45: 'Мышь', 46: '08471001001000000', 49: '1501886', 52: 1, 53: 100, 56: 100, 57: 12, 58: 12, 59: 112, 65: 2 });
    row({ 1: 2, 2: 0, 4: 'EXL-2', 5: '16.10.2026', 13: '"ALFA" MCHJ', 14: '310529901', 28: '302936161', 41: 1, 45: 'Консультация', 46: '10306002005000000', 52: 1, 53: 500, 56: 500, 57: 'Без НДС', 58: 0, 59: 500, 65: 3 });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // didox ЭСФ template: header fields in fixed cells (cols 1–40), lines in AO–BH; column A starts the next invoice; "Без НДС" is a no-VAT line.
  it('reads the template as a preset: two invoices, header cells, a no-VAT line', async () => {
    const read = await readDidoxUpload(await template(), 'shablon-esf.xlsx');
    assert.equal(read.kind, 'xlsx');
    if (read.kind !== 'xlsx') return;
    assert.ok(esfTemplateRows(read.sheet));
    const docs = templateToDocuments(read.sheet);
    assert.deepEqual(docs.map((d) => d.lines), [2, 1]);
    const [first, second] = docs.map((d) => ok(d.document, { source: 'xlsx' }));
    assert.deepEqual([first?.meta.number, first?.meta.date, first?.meta.contractDate, first?.meta.seller.inn, first?.meta.seller.name, first?.meta.buyer.name], ['EXL-1', '2026-10-15', '2026-01-01', '310529901', '"ALFA" MCHJ', '"BETA" MCHJ']);
    assert.deepEqual(first?.lines.map((l) => [l.name, l.mxik, l.packageCode, l.quantity, l.total]), [['Ноутбук', '08471001001000000', '1501886', '2', '2240'], ['Мышь', '08471001001000000', '1501886', '1', '112']]);
    assert.deepEqual([second?.meta.number, second?.lines[0]?.vatRate, second?.lines[0]?.didox.withoutVat, second?.lines[0]?.didox.origin], ['EXL-2', null, true, 3]);
    assert.ok(first && second && [...first.lines, ...second.lines].every((l) => l.issues.length === 0));
    // The header signature a remembered mapping is keyed on ignores case and punctuation.
    assert.equal(sheetSignature(['Наименование', 'Кол-во', 'A']), sheetSignature(['НАИМЕНОВАНИЕ ', 'Колво', 'B']));
  });

  // Review 30 Oct (R-D12): the instruction says column A on an invoice's first line is enough; repeated on every line it
  // made each line an invoice, and the second was refused as a duplicate.
  it('column A (and the number) repeated on every line of an invoice keeps it one invoice', async () => {
    const read = await readDidoxUpload(await template(true), 'shablon-esf.xlsx');
    assert.ok(read.kind === 'xlsx');
    assert.deepEqual(templateToDocuments(read.sheet).map((d) => d.lines), [2, 1]);
  });
});

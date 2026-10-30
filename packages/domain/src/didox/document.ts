// A Didox document JSON → the contract's IncomingInvoiceMeta and InvoiceLine[].
//
// The shape follows Didox's official integrator docs (api-docs.didox.uz, read 30 Oct 2026) and one
// real export, as collected in tmp/real-docs/didox/RESEARCH.md (cited below as "§n"; the checklist
// items as "§7.n"). Still NOT VERIFIED against a live Didox account: no real incoming document has
// been read through the API yet, only the docs' examples, one real export ZIP and third-party
// parsers that ran on real documents.
//
// What a document can look like (§2, §6, §7.1-16):
//   - keys in PascalCase (what is POSTed to /create) or lowercase (what Didox returns); read alike;
//   - four envelopes: the bare document (ZIP export), `{data:{json, document}}` (GET /v1/documents/{id}),
//     `{pending_document:{document_json}, _id}` (create), `{"Factura": {...}}` (2020 roaming);
//   - numbers as numbers or strings, with float noise; 17-digit codes that must never pass through
//     a JS number; `packagecode` a string or a number; `measureid` null, "", "46" or 1;
//   - one-sided invoices (`buyer: null`, `singlesidedtype`), corrected ones (`facturatype` ≠ 0 with
//     `oldfacturadoc`), pharm 008 (`hasmedical` + per-line serial/basesumma/profitrate/dispensetype),
//     hybrid 023 (a different PascalCase shape), acts 005 (`actdoc`, refused here).
//
// Pure: no database, no network. The caller adds the product match and the rules (check.ts, rules.ts).
import { createHash } from 'node:crypto';
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { absDiff, fractionDigits, multiply, normalizeDecimal, percentOf, readDecimal, sum, tiyin, toDecimalString, type Micros } from './decimal.js';

export type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
export type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
export type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;

/** Shown wherever the parser's result is reported. */
export const SHAPE_VERIFIED = false as const;
export const SHAPE_NOTE = 'Didox document shape: official integrator docs and one real export (RESEARCH.md §2); not yet read from a live Didox account.';

/** What kind of Didox document a JSON is (§1.4 doctypes; detection by the header block each type has). */
export type DidoxKind = 'invoice' | 'hybrid' | 'act' | 'waybill' | 'empowerment' | 'contract' | 'reconciliation' | 'free_form' | 'unknown';

/** Where the document sat (§7.2). */
export type Envelope = 'bare' | 'get' | 'create' | 'factura_2020' | 'wrapped';

/** Per-line fields Didox carries beyond the contract's line; kept in the record payload as `didox`. */
export type LineExtras = {
  origin: number | null;
  /** `withoutvat` as sent, or a line whose VAT is 0 and whose total is its amount (§5 V7). */
  withoutVat: boolean;
  /** The rate the document printed, even on a line read as without VAT. */
  vatRateStated: string | null;
  exciseRate: string | null;
  exciseSum: string | null;
  lgota: { id: string; type: number | null; name: string | null; vatSum: string | null } | null;
  committent: { name: string | null; tin: string | null } | null;
  /** `marks` was a non-empty object or array. */
  marked: boolean;
  /** Only when the product list says `hasmedical` (§7.15). */
  pharm: { serial: string | null; baseSumma: string | null; profitRate: string | null; dispenseType: number | null } | null;
  /** The numbers exactly as written, for the decimal-places rule (§7.20). */
  raw: Record<'count' | 'summa' | 'deliverysum' | 'vatrate' | 'vatsum' | 'deliverysumwithvat', unknown>;
};

/** A line as read, before matching: the contract's line without the match, plus its own issues. */
export type ParsedLine = Omit<InvoiceLine, 'product' | 'resolved'> & {
  /** The catalog code exactly as the document had it (for mxik_invalid / mxik_missing). */
  rawCatalogCode: string | null;
  issues: ValidationIssue[];
  didox: LineExtras;
};

/** Party fields the rules look at (§2.2), exactly as written. */
export type PartyExtras = {
  rawTin: string | null; vatRegCode: string | null; vatRegStatus: string | null; director: string | null;
  account: string | null; bankId: string | null; branchCode: string | null; present: boolean;
};

export type Signer = { taxId: string | null; name: string | null; signedAt: string | null };

export type ParsedInvoice = {
  meta: IncomingInvoiceMeta;
  lines: ParsedLine[];
  /** Issues about the document as a whole (seller TIN unreadable, header totals). */
  documentIssues: ValidationIssue[];
  /** The roaming factura id (`facturaid`, 24 hex), when present. Didox's own id is meta.externalId. */
  facturaId: string | null;
  /** `facturatype` as read ("0" standard, "4" corrected, … §2.1). */
  facturaType: string | null;
  /** SHA-256 of the normalised document JSON: lower-case keys, sorted, wrapper fields dropped. */
  fingerprint: string;
  /** 002 ЭСФ, 008 pharm, 023 hybrid. */
  docType: '002' | '008' | '023';
  envelope: Envelope;
  singleSidedType: number | null;
  /** The invoice this one corrects or adds to (§5 V13). */
  oldFactura: { id: string | null; number: string | null; date: string | null } | null;
  flags: { hasVat: boolean | null; hasExcise: boolean | null; hasCommittent: boolean | null; hasLgota: boolean | null; hasMarking: boolean | null; hasMedical: boolean | null };
  parties: { seller: PartyExtras; buyer: PartyExtras };
  contractId: string | null;
  lotId: string | null;
  /** Header totals the source stated (hybrid product groups, the list entry); null = only the lines' sums exist. */
  statedTotals: StatedTotals | null;
  /** Where meta's totals come from (B6: never the lines when the document states them). */
  totalsFrom: 'document' | 'list' | 'lines';
  /** From the GET envelope's `data.document` (§1.3 row 3). */
  signers: Signer[];
  statusComment: string | null;
};

export type StatedTotals = { amount: string | null; vat: string | null; withVat: string | null };

export type ParseError = 'unreadable' | 'not_invoice' | 'missing_header' | 'no_lines' | 'too_many_lines';
export type ParseOutcome =
  | { ok: true; invoice: ParsedInvoice }
  | { ok: false; error: ParseError; kind: DidoxKind; detail?: string };

export type ParseOptions = {
  /** 'didox_api' | 'didox_zip' | 'didox_json' | 'xlsx'. */
  source: string;
  /** The Didox document id when known (API, list entry); otherwise the wrapper's id fields. */
  didoxId?: string | null;
  /** Didox status as the list read it. */
  didoxStatus?: string | null;
  /** The doctype the list named ("002", "008", "023"). */
  docType?: string | null;
  /** measureId → name from GET /v1/measures/all. */
  measures?: ReadonlyMap<string, string>;
  /** The list entry's `total_delivery_sum` / `total_vat_sum` / `total_delivery_sum_with_vat` (§1.3: `total_sum` is not the total). */
  listTotals?: StatedTotals | null;
};

export const MAX_LINES = 5_000;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every object key lower-cased, recursively: the upper-case `FacturaDoc` / `ProductList.Products` form reads like the lower-case one. */
export function lowerKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lowerKeys);
  if (!isObj(value)) return value;
  const out: Obj = {};
  for (const [k, v] of Object.entries(value)) out[k.toLowerCase()] = lowerKeys(v);
  return out;
}

/** Keys whose numeric value is a code that a JS number would round or strip of its leading zeros. */
const CODE_KEYS = /("(?:catalogcode|catalog_code|productcode|product_code|mxik|ikpu|barcode|account|accountnumber|sellertin|buyertin|tin|tinorpinfl|pinfl)"\s*:\s*)(\d{10,})(?=\s*[,}\]])/gi;

/**
 * JSON.parse for Didox text: the BOM dropped and long numeric codes quoted first, so
 * `"catalogcode": 02100000000000001` or `10403003014000001` (above 2^53) arrive as the digits
 * written, not as a mangled float (§7.5; the didox-parser repo needed the same regex workaround).
 */
export function parseDidoxJson(text: string): unknown {
  const clean = text.replace(/^\uFEFF/, '');
  return JSON.parse(clean.replace(CODE_KEYS, '$1"$2"'));
}

/** JSON with sorted keys, for a fingerprint that does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** Kind detection by the header block each doctype carries (§2, samples 02/05/07/08/09/10). */
export function detectKind(doc: unknown): DidoxKind {
  if (!isObj(doc)) return 'unknown';
  if ('facturadoc' in doc && 'productlist' in doc) return 'invoice';
  if ('hybridinvoicedoc' in doc) return 'hybrid';
  if ('actdoc' in doc) return 'act';
  if ('waybilldoc' in doc) return 'waybill';
  if ('empowermentdoc' in doc) return 'empowerment';
  if ('verificationactdoc' in doc) return 'reconciliation';
  if ('contractdoc' in doc && 'owner' in doc && 'parts' in doc) return 'contract';
  if ('document' in doc && 'documentid' in doc) return 'free_form';
  return 'unknown';
}

export type Unwrapped = { doc: Obj | null; kind: DidoxKind; wrapperId: string | null; envelope: Envelope; metadata: Obj | null };

/**
 * The document object inside whatever wraps it (§7.2): bare, GET `{data:{json, document}}`,
 * create `{pending_document:{document_json}, _id}`, 2020 `{"Factura":…}`, or a `json` field holding
 * the document as a string. Answers the first candidate whose kind is known, the id the wrapper
 * carried, and the GET envelope's metadata block (status, doctype, signatures).
 */
export function unwrap(input: unknown): Unwrapped {
  const lowered = lowerKeys(input);
  const queue: Array<{ value: unknown; via: string }> = [{ value: lowered, via: '' }];
  let wrapperId: string | null = null;
  let metadata: Obj | null = null;
  for (let i = 0; i < queue.length && i < 16; i++) {
    const item = queue[i] as { value: unknown; via: string };
    let candidate = item.value;
    if (typeof candidate === 'string') {
      try { candidate = lowerKeys(parseDidoxJson(candidate)); } catch { continue; }
    }
    if (!isObj(candidate)) continue;
    if (isObj(candidate['json']) || typeof candidate['json'] === 'string') {
      // GET /v1/documents/{id}: data.json is the document, data.document its metadata.
      if (isObj(candidate['document'])) metadata ??= candidate['document'];
    }
    wrapperId ??= text(candidate['_id']) ?? text(candidate['doc_id']) ?? text(candidate['didoxid']) ?? (metadata ? text(metadata['doc_id']) ?? text(metadata['_id']) : null);
    const kind = detectKind(candidate);
    if (kind !== 'unknown') {
      const envelope: Envelope = item.via === '' ? 'bare'
        : item.via.endsWith('json') && metadata ? 'get'
        : item.via.includes('pending_document') ? 'create'
        : item.via.endsWith('factura') ? 'factura_2020' : 'wrapped';
      return { doc: candidate, kind, wrapperId, envelope, metadata };
    }
    for (const key of ['json', 'document_json', 'pending_document', 'factura', 'data', 'doc']) {
      if (key in candidate) queue.push({ value: candidate[key], via: `${item.via}/${key}` });
    }
    // `document` is a wrapper only when it is not the GET metadata block.
    if ('document' in candidate && candidate['document'] !== metadata) queue.push({ value: candidate['document'], via: `${item.via}/document` });
  }
  return { doc: isObj(lowered) ? lowered : null, kind: 'unknown', wrapperId, envelope: 'bare', metadata };
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

const digits = (value: unknown): string | null => {
  const t = text(value);
  if (t === null) return null;
  const d = t.replace(/\D/g, '');
  return d || null;
};

const int = (value: unknown): number | null => {
  const t = text(value);
  if (t === null || !/^-?\d+$/.test(t)) return null;
  return Number(t);
};

const bool = (value: unknown): boolean | null => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
};

const pick = (obj: Obj | undefined | null, ...keys: string[]): unknown => {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
};

/** An optional block that arrived as an object of empty strings and nulls is absent (§7.7). */
const blockOf = (value: unknown): Obj | null => (isObj(value) && Object.values(value).some((v) => v !== null && v !== '' && v !== undefined) ? value : null);

/** `2026-10-01`, `2026-10-01T…`, `01.10.2026`, `2025.09.16 14:55:23`, epoch milliseconds → `2026-10-01`; null otherwise. */
export function isoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1e11) {
    // Epoch ms; Tashkent is UTC+5 with no daylight saving.
    return new Date(value + 5 * 3600_000).toISOString().slice(0, 10);
  }
  const t = text(value);
  if (!t) return null;
  let m = /^(\d{4})[-.](\d{2})[-.](\d{2})/.exec(t);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{2})[./](\d{2})[./](\d{4})/.exec(t);
  if (m) return valid(m[3], m[2], m[1]);
  return null;
}

function valid(y?: string, mo?: string, d?: string): string | null {
  if (!y || !mo || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d) ? `${y}-${mo}-${d}` : null;
}

const INN = /^(\d{9}|\d{14})$/;
const MXIK = /^\d{17}$/;

function party(doc: Obj, prefix: 'seller' | 'buyer'): { name: string; inn: string | null; account: string | null; mfo: string | null; extras: PartyExtras } {
  const nested = isObj(doc[prefix]) ? doc[prefix] : undefined;
  const rawTin = digits(pick(doc, `${prefix}tin`)) ?? digits(pick(nested, 'tin', 'inn', 'pinfl', 'tinorpinfl'));
  const name = text(pick(nested, 'name')) ?? text(pick(doc, `${prefix}name`)) ?? '';
  const accountRaw = text(pick(nested, 'account', 'accountnumber'));
  const bankRaw = text(pick(nested, 'bankid', 'mfo', 'bankmfo'));
  const account = accountRaw?.replace(/\s/g, '') ?? null;
  const mfo = bankRaw?.replace(/\s/g, '') ?? null;
  return {
    name: name.slice(0, 300), inn: rawTin && INN.test(rawTin) ? rawTin : null,
    account: account && /^\d{20}$/.test(account) ? account : null,
    mfo: mfo && /^\d{5}$/.test(mfo) ? mfo : null,
    extras: {
      rawTin, account: accountRaw, bankId: bankRaw,
      vatRegCode: text(pick(nested, 'vatregcode')), vatRegStatus: text(pick(nested, 'vatregstatus')),
      director: text(pick(nested, 'director')), branchCode: text(pick(nested, 'branchcode')),
      present: Boolean(nested) || Boolean(rawTin),
    },
  };
}

function productArray(doc: Obj): unknown[] {
  const list = doc['productlist'];
  if (Array.isArray(list)) return list;
  if (isObj(list) && Array.isArray(list['products'])) return list['products'] as unknown[];
  return [];
}

/**
 * A hybrid (023) document in the invoice's own field names, so one parser reads both (§2.5,
 * sample 07): `HybridInvoiceDoc{No,Date}`, `Seller.TinOrPinfl/AccountNumber/BankMfo`, and the
 * lines under `Roadway.ProductGroups[].ProductInfo.Products[]` with `Amount`, `Price`, `Vat{Rate,Sum}`.
 */
function hybridAsInvoice(doc: Obj): { doc: Obj; totals: StatedTotals | null } {
  const head = isObj(doc['hybridinvoicedoc']) ? doc['hybridinvoicedoc'] : {};
  const contract = isObj(doc['contractdoc']) ? doc['contractdoc'] : {};
  const roadway = isObj(doc['roadway']) ? doc['roadway'] : {};
  const groups = Array.isArray(roadway['productgroups']) ? (roadway['productgroups'] as unknown[]).filter(isObj) : [];
  const products: Obj[] = [];
  const totals = { amount: [] as Micros[], vat: [] as Micros[], withVat: [] as Micros[] };
  let stated = false;
  for (const g of groups) {
    const info = isObj(g['productinfo']) ? g['productinfo'] : {};
    for (const p of Array.isArray(info['products']) ? (info['products'] as unknown[]).filter(isObj) : []) {
      const vat = isObj(p['vat']) ? p['vat'] : {};
      const relief = isObj(p['taxrelief']) ? p['taxrelief'] : null;
      const committent = isObj(p['committent']) ? p['committent'] : null;
      const medical = isObj(p['medical']) ? p['medical'] : null;
      products.push({
        ...p, count: p['amount'], summa: p['price'], vatrate: vat['rate'], vatsum: vat['sum'],
        withoutvat: vat['rate'] === null && vat['sum'] === null ? undefined : p['withoutvat'],
        lgotaid: relief?.['id'] ?? null, lgotaname: relief?.['name'] ?? null, lgotavatsum: relief?.['vatsum'] ?? null, lgotatype: relief?.['type'] ?? null,
        committentname: committent?.['name'] ?? '', committenttin: committent?.['tinorpinfl'] ?? committent?.['tin'] ?? '',
        ...(medical ? { serial: medical['serial'], basesumma: medical['basesumma'], profitrate: medical['profitrate'], dispensetype: medical['dispensetype'] } : {}),
      });
    }
    for (const [key, into] of [['totaldeliverysum', totals.amount], ['totalvatsum', totals.vat], ['totaldeliverysumwithvat', totals.withVat]] as const) {
      const v = readDecimal(info[key]);
      if (v !== null) { into.push(v); stated = true; }
    }
  }
  const total = (list: Micros[]): string | null => (list.length === groups.length && list.length > 0 ? toDecimalString(sum(list)) : null);
  const old = blockOf(doc['oldhybridinvoicedoc']);
  return {
    doc: {
      facturadoc: { facturano: head['no'], facturadate: head['date'] },
      contractdoc: { contractno: contract['no'] ?? contract['contractno'], contractdate: contract['date'] ?? contract['contractdate'] },
      facturatype: doc['hybridinvoicetype'],
      oldfacturadoc: old ? { oldfacturaid: old['id'] ?? old['oldhybridinvoiceid'], oldfacturano: old['no'], oldfacturadate: old['date'] } : null,
      seller: doc['seller'], buyer: doc['buyer'],
      hasmarking: doc['hasmarking'],
      productlist: { hasvat: undefined, hasexcise: doc['hasexcise'], hascommittent: doc['hascommittent'], haslgota: doc['hastaxrelief'], hasmedical: doc['hasmedicalequipment'], products },
    },
    totals: stated ? { amount: total(totals.amount), vat: total(totals.vat), withVat: total(totals.withVat) } : null,
  };
}

/**
 * Tolerances of the line arithmetic in micros (§5 V6, §7.21 `|count×summa − deliverysum| ≤ 0.5 tiyin × count`): a price
 * written to two decimals may be off by half a tiyin per unit; a price with more decimals is checked to one tiyin.
 * Review 30 Oct (R-D8): this was rounded up to whole tiyin with a one-tiyin floor and another half tiyin on top, so
 * count 1 × 100.00 = 100.01 passed.
 */
export function amountTolerance(count: Micros, priceDecimals: number | null): bigint {
  if (priceDecimals !== null && priceDecimals > 2) return 10_000n;
  return (count < 0n ? -count : count) / 200n; // 5 000 micros (half a tiyin) per unit
}

/** VAT and amount + VAT: one tiyin (§7.21). */
const ONE_TIYIN = 10_000n;

/** `stated` (in tiyin) vs `expected` within `allowed` micros; an `expected` with sub-tiyin digits may round half a tiyin more. */
const withinTiyin = (stated: Micros, expected: Micros, allowed: bigint): boolean =>
  absDiff(stated, expected) <= allowed + (expected % 10_000n === 0n ? 0n : 5_000n);

function parseLine(raw: unknown, index: number, measures: ReadonlyMap<string, string> | undefined, medical: boolean): ParsedLine {
  const p = isObj(raw) ? raw : {};
  const issues: ValidationIssue[] = [];
  const ordno = Number(text(p['ordno']));
  const lineNo = Number.isInteger(ordno) && ordno >= 1 ? ordno : index + 1;
  const rawCatalogCode = text(p['catalogcode']);
  const code = rawCatalogCode?.replace(/\s/g, '') ?? null;
  const mxik = code && MXIK.test(code) ? code : null;
  if (!rawCatalogCode) issues.push({ code: 'mxik_missing', severity: 'error', field: 'mxik' });
  else if (!mxik) {
    // §7.17: the leading zero is what gets lost ("у ИКПУ, который начинается с «0», забывают ставить эту цифру").
    const padded = code && /^\d{16}$/.test(code) ? `0${code}` : null;
    issues.push({ code: 'mxik_invalid', severity: 'error', field: 'mxik', params: { value: rawCatalogCode.slice(0, 40), ...(padded ? { reason: 'leading_zero' } : {}) }, ...(padded ? { suggestion: padded } : {}) });
  }

  const measureId = text(p['measureid']);
  const quantity = readDecimal(p['count']) ?? 0n;
  const priceRaw = pick(p, 'summa', 'price');
  const price = readDecimal(priceRaw) ?? 0n;
  const amountRead = readDecimal(pick(p, 'deliverysum', 'totalsumwithoutvat'));
  const amount = amountRead ?? multiply(quantity, price);
  const vatRateStated = readDecimal(p['vatrate']);
  const vatRead = readDecimal(p['vatsum']);
  const totalRead = readDecimal(pick(p, 'deliverysumwithvat', 'totalsum', 'totalsumwithvat'));
  // §5 V7: flagged "without VAT", or no VAT charged and the total is the amount, whatever rate is printed.
  const withoutVat = bool(p['withoutvat']) === true
    || (vatRateStated !== null && vatRateStated > 0n && vatRead === 0n && totalRead !== null && absDiff(tiyin(totalRead), tiyin(amount)) <= 1n);
  const vatRate = withoutVat ? null : vatRateStated;
  const vat = withoutVat ? (vatRead ?? 0n) : vatRead ?? (vatRate !== null ? percentOf(amount, vatRate) : null);
  const total = totalRead ?? amount + (vat ?? 0n);

  // Arithmetic the document must agree with itself on, in tiyin; the document's own numbers are kept.
  const checks: Array<[string, Micros, Micros, bigint]> = [];
  const priceDecimals = priceRaw === undefined ? null : fractionDigits(priceRaw);
  if (amountRead !== null && quantity !== 0n && price !== 0n) checks.push(['amount', amountRead, multiply(quantity, price), amountTolerance(quantity, priceDecimals)]);
  if (vatRead !== null && vatRate !== null) checks.push(['vatAmount', vatRead, percentOf(amount, vatRate), ONE_TIYIN]);
  if (totalRead !== null) checks.push(['total', totalRead, amount + (vat ?? 0n), ONE_TIYIN]);
  for (const [field, stated, expected, allowed] of checks) {
    if (!withinTiyin(stated, expected, allowed)) {
      issues.push({ code: 'totals_mismatch', severity: 'warning', field, params: { stated: toDecimalString(stated), expected: toDecimalString(expected) } });
    }
  }
  if (quantity <= 0n) issues.push({ code: 'quantity_invalid', severity: 'error', field: 'quantity', params: { value: toDecimalString(quantity) } });

  const packageName = text(p['packagename']);
  const lgotaId = text(p['lgotaid']);
  const committentTin = digits(p['committenttin']);
  const committentName = text(p['committentname']);
  const marks = p['marks'];
  return {
    lineNo,
    // Tabs and newlines inside a name stay for display (§7.8); the matcher folds them.
    name: (text(p['name']) ?? '').slice(0, 500),
    mxik,
    mxikName: text(p['catalogname'])?.slice(0, 500) ?? null,
    packageCode: text(pick(p, 'packagecode', 'package_code'))?.slice(0, 40) ?? null,
    packageName: packageName?.slice(0, 200) ?? null,
    measureId: measureId?.slice(0, 20) ?? null,
    unit: (measureId ? measures?.get(measureId) : null)?.slice(0, 60) ?? null,
    barcode: digits(pick(p, 'barcode'))?.slice(0, 40) ?? null,
    quantity: toDecimalString(quantity),
    price: toDecimalString(price),
    amount: toDecimalString(amount),
    vatRate: vatRate === null ? null : toDecimalString(vatRate),
    vatAmount: vat === null ? null : toDecimalString(vat),
    total: toDecimalString(total),
    rawCatalogCode,
    issues,
    didox: {
      origin: int(p['origin']),
      withoutVat,
      vatRateStated: vatRateStated === null ? null : toDecimalString(vatRateStated),
      exciseRate: normalizeDecimal(p['exciserate']), exciseSum: normalizeDecimal(p['excisesum']),
      lgota: lgotaId ? { id: lgotaId, type: int(p['lgotatype']), name: text(p['lgotaname'])?.slice(0, 300) ?? null, vatSum: normalizeDecimal(p['lgotavatsum']) } : null,
      committent: committentTin || committentName ? { name: committentName, tin: committentTin } : null,
      marked: (isObj(marks) && Object.keys(marks).length > 0) || (Array.isArray(marks) && marks.length > 0),
      pharm: medical ? { serial: text(p['serial']), baseSumma: normalizeDecimal(p['basesumma']), profitRate: normalizeDecimal(p['profitrate']), dispenseType: int(p['dispensetype']) } : null,
      raw: { count: p['count'], summa: priceRaw, deliverysum: pick(p, 'deliverysum', 'totalsumwithoutvat'), vatrate: p['vatrate'], vatsum: p['vatsum'], deliverysumwithvat: pick(p, 'deliverysumwithvat', 'totalsum', 'totalsumwithvat') },
    },
  };
}

/** Signatures arrive as a JSON string holding an array (§7.12): parsed twice. */
export function readSigners(value: unknown): Signer[] {
  let list: unknown = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((s) => ({
    taxId: text(s['taxId'] ?? s['taxid']),
    name: text(s['fullName'] ?? s['fullname'])?.slice(0, 200) ?? null,
    // `2025.09.16 14:55:23` → ISO, Tashkent time.
    signedAt: ((): string | null => {
      const m = /^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text(s['signingTime'] ?? s['signingtime']) ?? '');
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:00` : null;
    })(),
  }));
}

/** ISO 4217 from a currency field, alphabetic or numeric (860 = UZS). */
const NUMERIC_CURRENCY: Record<string, string> = { '860': 'UZS', '840': 'USD', '978': 'EUR', '643': 'RUB', '398': 'KZT', '156': 'CNY' };
function currencyOf(doc: Obj): string {
  for (const key of ['currency', 'currencycode', 'currency_code', 'valyuta']) {
    const t = text(doc[key])?.toUpperCase();
    if (!t) continue;
    if (/^[A-Z]{3}$/.test(t)) return t === 'SUM' ? 'UZS' : t;
    if (NUMERIC_CURRENCY[t]) return NUMERIC_CURRENCY[t];
  }
  return 'UZS';
}

/** Parses one Didox document JSON (already JSON.parse'd, or a string). Refuses non-invoices with their kind. */
export function parseDidoxDocument(input: unknown, options: ParseOptions): ParseOutcome {
  let value = input;
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    try { value = parseDidoxJson(String(value)); } catch { return { ok: false, error: 'unreadable', kind: 'unknown' }; }
  }
  const { doc: found, kind, wrapperId, envelope, metadata } = unwrap(value);
  if (!found) return { ok: false, error: 'unreadable', kind: 'unknown' };
  if (kind !== 'invoice' && kind !== 'hybrid') return { ok: false, error: 'not_invoice', kind };
  const hybrid = kind === 'hybrid' ? hybridAsInvoice(found) : null;
  const doc = hybrid?.doc ?? found;

  const factura = isObj(doc['facturadoc']) ? doc['facturadoc'] : {};
  const contract = isObj(doc['contractdoc']) ? doc['contractdoc'] : {};
  const number = text(pick(factura, 'facturano', 'number', 'no'));
  const date = isoDate(pick(factura, 'facturadate', 'date'));
  const missing = [!number && 'facturadoc.facturano', !date && 'facturadoc.facturadate'].filter(Boolean);
  if (!number || !date) return { ok: false, error: 'missing_header', kind, detail: missing.join(', ') };

  const products = productArray(doc);
  if (products.length === 0) return { ok: false, error: 'no_lines', kind };
  if (products.length > MAX_LINES) return { ok: false, error: 'too_many_lines', kind, detail: String(products.length) };
  const list = isObj(doc['productlist']) ? doc['productlist'] : {};
  const hasMedical = bool(list['hasmedical']);
  const lines = products.map((p, i) => parseLine(p, i, options.measures, hasMedical === true));

  const seller = party(doc, 'seller');
  const buyer = party(doc, 'buyer');
  const documentIssues: ValidationIssue[] = [];
  if (!seller.inn) documentIssues.push({ code: 'seller_tin_invalid', severity: 'warning', field: 'seller.inn', params: { value: seller.extras.rawTin ?? '' } });

  // B6: the header totals are the document's (hybrid) or the list entry's when the source states them; the lines' sums otherwise.
  const lineAmount = sum(lines.map((l) => readDecimal(l.amount) ?? 0n));
  const vats = lines.map((l) => readDecimal(l.vatAmount));
  const lineVat = vats.every((v) => v === null) ? null : sum(vats.map((v) => v ?? 0n));
  const lineWithVat = sum(lines.map((l) => readDecimal(l.total) ?? 0n));
  const statedTotals = hybrid?.totals ?? options.listTotals ?? null;
  const totalsFrom: ParsedInvoice['totalsFrom'] = hybrid?.totals ? 'document' : options.listTotals ? 'list' : 'lines';
  const stated = (v: string | null | undefined): Micros | null => (v == null ? null : readDecimal(v));
  const totalAmount = stated(statedTotals?.amount) ?? lineAmount;
  const totalVat = stated(statedTotals?.vat) ?? lineVat;
  const totalWithVat = stated(statedTotals?.withVat) ?? lineWithVat;
  if (statedTotals) {
    // §7.21: the lines must add up to the stated totals (one tiyin per line of rounding).
    const allowed = BigInt(Math.max(1, lines.length));
    for (const [field, s, l] of [['totalAmount', stated(statedTotals.amount), lineAmount], ['totalVat', stated(statedTotals.vat), lineVat ?? 0n], ['totalWithVat', stated(statedTotals.withVat), lineWithVat]] as const) {
      if (s !== null && absDiff(tiyin(s), tiyin(l)) > allowed) {
        documentIssues.push({ code: 'header_totals_mismatch', severity: 'warning', field, params: { stated: toDecimalString(s), lines: toDecimalString(l), source: totalsFrom } });
      }
    }
  }

  const facturaId = text(pick(doc, 'facturaid')) ?? text(pick(factura, 'facturaid')) ?? (hybrid ? text(found['hybridinvoiceid']) : null);
  const didoxId = options.didoxId ?? wrapperId ?? null;
  const metaStatus = metadata ? text(metadata['doc_status'] ?? metadata['status']) : null;
  const status = options.didoxStatus ?? metaStatus ?? null;
  const docType: ParsedInvoice['docType'] = kind === 'hybrid' ? '023' : hasMedical === true ? '008' : '002';
  const facturaType = text(pick(doc, 'facturatype')) ?? (metadata ? text(metadata['factura_type']) : null);
  const old = blockOf(doc['oldfacturadoc']);
  const meta: IncomingInvoiceMeta = {
    source: options.source.slice(0, 20),
    externalId: (didoxId ?? facturaId)?.slice(0, 80) ?? null,
    number: number.slice(0, 60),
    date,
    contractNumber: text(pick(contract, 'contractno', 'number'))?.slice(0, 60) ?? null,
    contractDate: isoDate(pick(contract, 'contractdate', 'date')),
    seller: { name: seller.name, inn: seller.inn, account: seller.account, mfo: seller.mfo, counterpartyId: null },
    buyer: { name: buyer.name, inn: buyer.inn, account: buyer.account, mfo: buyer.mfo, counterpartyId: null },
    currency: currencyOf(doc),
    totalAmount: toDecimalString(totalAmount),
    totalVat: totalVat === null ? null : toDecimalString(totalVat),
    totalWithVat: toDecimalString(totalWithVat),
    didoxStatus: status?.slice(0, 40) ?? null,
    signed: status === null ? null : statusInfo(options.docType ?? docType, status).signed,
  };

  return {
    ok: true,
    invoice: {
      meta, lines, documentIssues, facturaId, facturaType,
      fingerprint: sha256(canonicalJson(found)),
      docType, envelope,
      singleSidedType: ((): number | null => { const t = int(doc['singlesidedtype']); return t && t > 0 ? t : null; })(),
      oldFactura: old ? { id: text(old['oldfacturaid']), number: text(old['oldfacturano']), date: isoDate(old['oldfacturadate']) } : null,
      flags: {
        hasVat: bool(list['hasvat']), hasExcise: bool(list['hasexcise']), hasCommittent: bool(list['hascommittent']),
        hasLgota: bool(list['haslgota']), hasMarking: bool(doc['hasmarking']), hasMedical,
      },
      parties: { seller: seller.extras, buyer: buyer.extras },
      contractId: text(doc['contractid']),
      lotId: text(doc['lotid']),
      statedTotals, totalsFrom,
      signers: readSigners(metadata?.['signature']),
      statusComment: metadata ? text(metadata['status_comment'])?.slice(0, 300) ?? null : null,
    },
  };
}

/** What a status means for a doctype family (§1.5, §7.13): `3` is signed for an ЭСФ, "read" for a letter (031). */
export type StatusState = 'draft' | 'pending' | 'signed' | 'rejected' | 'deleted' | 'cancelled' | 'invalid' | 'annulled' | 'agent' | 'unknown';
export function statusInfo(doctype: string | null, status: string): { state: StatusState; signed: boolean | null } {
  const s = status.trim().toLowerCase();
  if (s === 'signed') return { state: 'signed', signed: true };
  const type = (doctype ?? '002').padStart(3, '0');
  if (type === '031') return { state: s === '3' ? 'unknown' : 'pending', signed: null };
  const states: Record<string, StatusState> = {
    '0': 'draft', '55': 'draft', '1': 'pending', '2': 'pending', '3': 'signed', '4': 'rejected', '5': 'deleted',
    '5555': 'cancelled', '40': 'invalid', '50': 'annulled', '60': 'agent',
  };
  const state = states[s] ?? 'unknown';
  // Hybrid 023 and waybills use 200-series codes whose "signed" member is not documented (§1.5).
  if (state === 'unknown') return { state, signed: type === '023' || type === '041' ? null : false };
  return { state, signed: state === 'signed' };
}

/** normalizeDecimal re-exported for callers that read single values (the XLSX source). */
export { normalizeDecimal };

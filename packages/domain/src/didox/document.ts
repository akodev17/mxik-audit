// A Didox document JSON → the contract's IncomingInvoiceMeta and InvoiceLine[].
//
// THE SHAPE IS THIRD-PARTY-DOCUMENTED, NOT VERIFIED AGAINST DIDOX. Didox publishes no API
// documentation. The keys below come from docs/accounting-2026-10-23/integration-research.md §1:
// source A (the 1C_integration repo's parser, run on 79 real documents, which takes the protocol
// from Didox's own 1C library) for the incoming lower-case shape, source B (npm `didox`) and the
// outgoing create body for the upper-case shape. The invoice number and date (`facturano`,
// `facturadate`) and the seller's `account` / `bankid` follow the Soliq e-invoice JSON that Didox
// relays; the research note does not list them, so they are read tolerantly and a document
// without them is refused with the field named. Package code, measure id and barcode on incoming
// lines are [UNKNOWN] in the note: read when present, never required.
//
// Pure: no database, no network. The caller adds the product match (check.ts).
import { createHash } from 'node:crypto';
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { absDiff, multiply, normalizeDecimal, percentOf, readDecimal, sum, toDecimalString, units, type Micros } from './decimal.js';

export type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
export type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
export type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;

/** Shown wherever the parser's result is reported. */
export const SHAPE_VERIFIED = false as const;
export const SHAPE_NOTE = 'Didox document shape: third-party-documented (research note §1), not verified against Didox.';

/** What kind of Didox document a JSON is (research note §1, source A's detection). */
export type DidoxKind = 'invoice' | 'act' | 'contract' | 'reconciliation' | 'free_form' | 'unknown';

/** A line as read, before matching: the contract's line without the match, plus its own issues. */
export type ParsedLine = Omit<InvoiceLine, 'product' | 'resolved'> & {
  /** The catalog code exactly as the document had it (for mxik_invalid / mxik_missing). */
  rawCatalogCode: string | null;
  issues: ValidationIssue[];
};

export type ParsedInvoice = {
  meta: IncomingInvoiceMeta;
  lines: ParsedLine[];
  /** Issues about the document as a whole (seller TIN unreadable, header totals). */
  documentIssues: ValidationIssue[];
  /** The Soliq factura id (`facturaid`), when present. */
  facturaId: string | null;
  /** Didox document type as read (`facturatype`), kept for the record. */
  facturaType: string | null;
  /** SHA-256 of the normalised document JSON: lower-case keys, sorted, wrapper fields dropped. */
  fingerprint: string;
};

export type ParseError = 'unreadable' | 'not_invoice' | 'missing_header' | 'no_lines' | 'too_many_lines';
export type ParseOutcome =
  | { ok: true; invoice: ParsedInvoice }
  | { ok: false; error: ParseError; kind: DidoxKind; detail?: string };

export type ParseOptions = {
  /** 'didox_api' | 'didox_zip' | 'didox_json'. */
  source: string;
  /** The Didox document id when known (API, list entry); otherwise the wrapper's id fields. */
  didoxId?: string | null;
  /** Didox status as the list read it. */
  didoxStatus?: string | null;
  /** measureId → name from GET /v1/measures/all. */
  measures?: ReadonlyMap<string, string>;
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

/** JSON with sorted keys, for a fingerprint that does not depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

export const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** Kind detection from source A: facturadoc+productlist = invoice, actdoc+productlist = act, and so on. */
export function detectKind(doc: unknown): DidoxKind {
  if (!isObj(doc)) return 'unknown';
  if ('facturadoc' in doc && 'productlist' in doc) return 'invoice';
  if ('actdoc' in doc && 'productlist' in doc) return 'act';
  if ('verificationactdoc' in doc) return 'reconciliation';
  if ('contractdoc' in doc && 'owner' in doc && 'parts' in doc) return 'contract';
  if ('document' in doc && 'documentid' in doc) return 'free_form';
  return 'unknown';
}

/**
 * The document object inside whatever wraps it: the bare document, `{ data: … }`, `{ document: … }`
 * or a `json` field holding the document as a string (the API answer's wrapper is [UNKNOWN]).
 * Answers the first candidate whose kind is known, plus the id fields the wrapper carried.
 */
export function unwrap(input: unknown): { doc: Obj | null; kind: DidoxKind; wrapperId: string | null } {
  const lowered = lowerKeys(input);
  const queue: unknown[] = [lowered];
  let wrapperId: string | null = null;
  for (let i = 0; i < queue.length && i < 12; i++) {
    let candidate = queue[i];
    if (typeof candidate === 'string') {
      try { candidate = lowerKeys(JSON.parse(candidate)); } catch { continue; }
    }
    if (!isObj(candidate)) continue;
    wrapperId ??= text(candidate['_id']) ?? text(candidate['doc_id']) ?? text(candidate['didoxid']);
    const kind = detectKind(candidate);
    if (kind !== 'unknown') return { doc: candidate, kind, wrapperId };
    for (const key of ['data', 'document', 'json', 'doc']) if (key in candidate) queue.push(candidate[key]);
  }
  return { doc: isObj(lowered) ? lowered : null, kind: 'unknown', wrapperId };
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

const pick = (obj: Obj | undefined, ...keys: string[]): unknown => {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
};

/** `2026-10-01`, `2026-10-01T…`, `01.10.2026`, epoch milliseconds → `2026-10-01`; null otherwise. */
export function isoDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1e11) {
    // Epoch ms; Tashkent is UTC+5 with no daylight saving.
    return new Date(value + 5 * 3600_000).toISOString().slice(0, 10);
  }
  const t = text(value);
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
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
/** One sum, or 0.01 % of the amount when that is larger: noise and rounding below this are not a mismatch. */
const tolerance = (amount: Micros): Micros => {
  const relative = (amount < 0n ? -amount : amount) / 10_000n;
  return relative > units(1) ? relative : units(1);
};

function party(doc: Obj, prefix: 'seller' | 'buyer'): { name: string; inn: string | null; account: string | null; mfo: string | null; rawTin: string | null } {
  const nested = isObj(doc[prefix]) ? (doc[prefix] as Obj) : undefined;
  const rawTin = digits(pick(doc, `${prefix}tin`)) ?? digits(pick(nested, 'tin', 'inn', 'pinfl'));
  const name = text(pick(nested, 'name')) ?? text(pick(doc, `${prefix}name`)) ?? '';
  const account = digits(pick(nested, 'account'));
  const mfo = digits(pick(nested, 'bankid', 'mfo'));
  return {
    name: name.slice(0, 300), inn: rawTin && INN.test(rawTin) ? rawTin : null, rawTin,
    account: account && /^\d{20}$/.test(account) ? account : null,
    mfo: mfo && /^\d{5}$/.test(mfo) ? mfo : null,
  };
}

function productArray(doc: Obj): unknown[] {
  const list = doc['productlist'];
  if (Array.isArray(list)) return list;
  if (isObj(list) && Array.isArray(list['products'])) return list['products'] as unknown[];
  return [];
}

function parseLine(raw: unknown, index: number, measures: ReadonlyMap<string, string> | undefined): ParsedLine {
  const p = isObj(raw) ? raw : {};
  const issues: ValidationIssue[] = [];
  const ordno = Number(text(p['ordno']));
  const lineNo = Number.isInteger(ordno) && ordno >= 1 ? ordno : index + 1;
  const rawCatalogCode = text(p['catalogcode']);
  const code = rawCatalogCode?.replace(/\s/g, '') ?? null;
  const mxik = code && MXIK.test(code) ? code : null;
  if (!rawCatalogCode) issues.push({ code: 'mxik_missing', severity: 'error', field: 'mxik' });
  else if (!mxik) issues.push({ code: 'mxik_invalid', severity: 'error', field: 'mxik', params: { value: rawCatalogCode.slice(0, 40) } });

  const measureId = text(p['measureid']);
  const quantity = readDecimal(p['count']) ?? 0n;
  const price = readDecimal(pick(p, 'summa', 'price')) ?? 0n;
  const amountRead = readDecimal(pick(p, 'deliverysum', 'totalsumwithoutvat'));
  const amount = amountRead ?? multiply(quantity, price);
  const withoutVat = p['withoutvat'] === true || p['withoutvat'] === 'true' || p['withoutvat'] === 1;
  const vatRate = withoutVat ? null : readDecimal(p['vatrate']);
  const vatRead = readDecimal(p['vatsum']);
  const vat = vatRead ?? (vatRate !== null ? percentOf(amount, vatRate) : null);
  const totalRead = readDecimal(pick(p, 'deliverysumwithvat', 'totalsum', 'totalsumwithvat'));
  const total = totalRead ?? amount + (vat ?? 0n);

  // Arithmetic the document must agree with itself on; the document's own numbers are kept.
  const checks: Array<[string, Micros, Micros]> = [];
  if (amountRead !== null && quantity !== 0n && price !== 0n) checks.push(['amount', amountRead, multiply(quantity, price)]);
  if (vatRead !== null && vatRate !== null) checks.push(['vatAmount', vatRead, percentOf(amount, vatRate)]);
  if (totalRead !== null) checks.push(['total', totalRead, amount + (vat ?? 0n)]);
  for (const [field, stated, expected] of checks) {
    if (absDiff(stated, expected) > tolerance(expected)) {
      issues.push({ code: 'totals_mismatch', severity: 'warning', field, params: { stated: toDecimalString(stated), expected: toDecimalString(expected) } });
    }
  }
  if (quantity <= 0n) issues.push({ code: 'quantity_invalid', severity: 'error', field: 'quantity', params: { value: toDecimalString(quantity) } });

  const packageName = text(p['packagename']);
  return {
    lineNo,
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
  };
}

/** Parses one Didox document JSON (already JSON.parse'd, or a string). Refuses non-invoices with their kind. */
export function parseDidoxDocument(input: unknown, options: ParseOptions): ParseOutcome {
  let value = input;
  if (typeof value === 'string' || Buffer.isBuffer(value)) {
    try { value = JSON.parse(String(value).replace(/^﻿/, '')); } catch { return { ok: false, error: 'unreadable', kind: 'unknown' }; }
  }
  const { doc, kind, wrapperId } = unwrap(value);
  if (!doc) return { ok: false, error: 'unreadable', kind: 'unknown' };
  if (kind !== 'invoice') return { ok: false, error: 'not_invoice', kind };

  const factura = isObj(doc['facturadoc']) ? (doc['facturadoc'] as Obj) : {};
  const contract = isObj(doc['contractdoc']) ? (doc['contractdoc'] as Obj) : {};
  const number = text(pick(factura, 'facturano', 'number', 'no'));
  const date = isoDate(pick(factura, 'facturadate', 'date'));
  const missing = [!number && 'facturadoc.facturano', !date && 'facturadoc.facturadate'].filter(Boolean);
  if (!number || !date) return { ok: false, error: 'missing_header', kind, detail: missing.join(', ') };

  const products = productArray(doc);
  if (products.length === 0) return { ok: false, error: 'no_lines', kind };
  if (products.length > MAX_LINES) return { ok: false, error: 'too_many_lines', kind, detail: String(products.length) };
  const lines = products.map((p, i) => parseLine(p, i, options.measures));

  const seller = party(doc, 'seller');
  const buyer = party(doc, 'buyer');
  const documentIssues: ValidationIssue[] = [];
  if (!seller.inn) documentIssues.push({ code: 'seller_tin_invalid', severity: 'warning', field: 'seller.inn', params: { value: seller.rawTin ?? '' } });

  const totalAmount = sum(lines.map((l) => readDecimal(l.amount) ?? 0n));
  const vats = lines.map((l) => readDecimal(l.vatAmount));
  const totalVat = vats.every((v) => v === null) ? null : sum(vats.map((v) => v ?? 0n));
  const totalWithVat = sum(lines.map((l) => readDecimal(l.total) ?? 0n));

  const facturaId = text(pick(doc, 'facturaid')) ?? text(pick(factura, 'facturaid'));
  const didoxId = options.didoxId ?? wrapperId ?? null;
  const status = options.didoxStatus ?? null;
  const meta: IncomingInvoiceMeta = {
    source: options.source.slice(0, 20),
    externalId: (didoxId ?? facturaId)?.slice(0, 80) ?? null,
    number: number.slice(0, 60),
    date,
    contractNumber: text(pick(contract, 'contractno', 'number'))?.slice(0, 60) ?? null,
    contractDate: isoDate(pick(contract, 'contractdate', 'date')),
    seller: { name: seller.name, inn: seller.inn, account: seller.account, mfo: seller.mfo, counterpartyId: null },
    buyer: { name: buyer.name, inn: buyer.inn, account: buyer.account, mfo: buyer.mfo, counterpartyId: null },
    currency: 'UZS',
    totalAmount: toDecimalString(totalAmount),
    totalVat: totalVat === null ? null : toDecimalString(totalVat),
    totalWithVat: toDecimalString(totalWithVat),
    didoxStatus: status?.slice(0, 40) ?? null,
    signed: status === null ? null : SIGNED_STATUSES.has(status),
  };

  return {
    ok: true,
    invoice: {
      meta, lines, documentIssues, facturaId,
      facturaType: text(pick(doc, 'facturatype')),
      fingerprint: sha256(canonicalJson(doc)),
    },
  };
}

/**
 * Didox statuses that mean "signed by both": source A's numbering (3 = signed). Source B numbers
 * differently (2 = SIGNED, which is "signed by partner" in A); research note §1 Unknown 2. Only
 * A's value counts until Didox confirms, so a B-numbered "2" reads as not yet signed (the safe side).
 */
const SIGNED_STATUSES = new Set(['3', 'signed']);

/** normalizeDecimal re-exported for callers that read single values (the XLSX source). */
export { normalizeDecimal };

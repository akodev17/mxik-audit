// The tax-side rules an incoming ЭСФ is held to (V17–V32 of the research checklist), on top of the
// parser's own arithmetic. Each rule cites its evidence: "R:<line>" is the line of
// tmp/real-docs/didox/RESEARCH.md that states it (§5 V1–V15 at lines 270–284, §7.17–32 at 337–352),
// which in turn names the Didox doc or tax source. Pure: the database facts come in `ctx.facts`
// (mirror.ts), the live Didox lists in `ctx.lists`, the corrected invoice's original in `ctx.original`.
//
// Severity follows what the finding means for booking the document in 1C, not for sending it: a
// received document already passed the roaming centre, so a structural slip is `info`; a code that
// the tax side refuses on the invoice date, or VAT that cannot be credited, is a `warning` or `error`.
import { resolveUnit } from '@tasnivo/core/normalize/index';
import { absDiff, fractionDigits, looseNumberFormat, percentOf, readDecimal, roundTo, tiyin, toDecimalString } from './decimal.js';
import { statusInfo, type ParsedInvoice, type ParsedLine, type ValidationIssue } from './document.js';
import type { MirrorFact } from './mirror.js';

export type RuleContext = {
  /** `YYYY-MM-DD`, Tashkent. */
  today: string;
  /** mirror.ts facts by code; absent = the mirror was not consulted (no code rules). */
  facts?: ReadonlyMap<string, MirrorFact> | null;
  /** Didox's restricted lists (GET /v1/utils/not-included-products, /compensation-works), when fetched. */
  lists?: { notIncluded: ReadonlySet<string>; compensation: ReadonlySet<string> } | null;
  /** The invoice a correction points to, as found among earlier imports; undefined = not looked up. */
  original?: { number: string; date: string; sellerInn: string | null } | null;
};

export type RuleResult = { document: ValidationIssue[]; lines: ValidationIssue[][] };

/** Days after the deactivation notice a code stays usable (ПКМ-263, R:236 / V2 R:271). */
export const DEACTIVATION_GRACE_DAYS = 30;

const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * VAT rates in force on a date. R:342 (§7.22) lists {0, 12, 15, 6}; the 15 there is the rate of
 * 01.10.2019–31.12.2022 (Tax Code 2019), not a 2026 rate: real 2025–2026 documents (samples 01, 05,
 * the didox-auditor cabinet data of July 2026) all carry 12. 6 % is the simplified regime Didox
 * announced (t.me/didox_info/1456, R:197) and is accepted from 01.06.2026.
 */
export function vatRatesOn(date: string): number[] {
  if (date < '2019-10-01') return [0, 20];
  if (date < '2023-01-01') return [0, 15];
  if (date < '2026-06-01') return [0, 12];
  return [0, 12, 6];
}

/** Russian unit and package words Didox prints, in the classifier's Uzbek Latin, so resolveUnit can read them. */
const RU_UNITS: Array<[RegExp, string]> = [
  [/^услуг[аи]?\s*\(сум\)$|^услуг[аи]?$/u, 'xizmat (soʻm)'],
  [/^куб(ический|\.)?\s*метр|^м3$|^м³$/u, 'kub. metr'],
  [/^квадратн(ый|\.)\s*метр|^кв\.?\s*м(етр)?$|^м2$/u, 'kv. metr'],
  [/^шт(ук[аи]?|\.)?$/u, 'dona'],
  [/^килограмм|^кг$/u, 'kilogramm'],
  [/^грамм|^г$/u, 'gramm'],
  [/^тонн[аы]?$|^т$/u, 'tonna'],
  [/^литр|^л$/u, 'litr'],
  [/^метр|^м$/u, 'metr'],
  [/^пар[аы]$/u, 'juft'],
  [/^комплект/u, 'toʻplam'],
];

/** The official unit id a line's package or measure name stands for, when it is a plain unit. */
export function unitIdOf(name: string | null): number | null {
  if (!name) return null;
  const direct = resolveUnit(name);
  if (direct) return direct.id;
  const key = name.trim().toLowerCase();
  for (const [rule, uz] of RU_UNITS) if (rule.test(key)) return resolveUnit(uz)?.id ?? null;
  return null;
}

/** A 16-digit code that is a 17-digit one without its leading zero (§7.17: "у ИКПУ, который начинается с «0», забывают ставить эту цифру"). */
export const leadingZeroCandidate = (raw: string | null): string | null => {
  const code = raw?.replace(/\s/g, '') ?? '';
  return /^\d{16}$/.test(code) ? `0${code}` : null;
};

/** Services are ИКПУ groups 099 and above; goods 001–098 (buxgalter text191810, R:207/214). */
export const isServiceCode = (code: string): boolean => Number(code.slice(0, 3)) >= 99;

const MONEY_FIELDS = ['summa', 'deliverysum', 'vatrate', 'vatsum', 'deliverysumwithvat'] as const;
const FIELD_OF: Record<string, string> = { count: 'quantity', summa: 'price', deliverysum: 'amount', vatrate: 'vatRate', vatsum: 'vatAmount', deliverysumwithvat: 'total' };
const CORRECTION_TYPES = new Set(['1', '4', '5', '6', '8', '9']);
const COMPENSATION_TYPES = new Set(['2', '5', '6']);
/** FacturaType codes 0–9 without 7 (api-docs 07 SubTypes, R:123). */
const FACTURA_TYPES = new Set(['0', '1', '2', '3', '4', '5', '6', '8', '9']);

function lineRules(inv: ParsedInvoice, line: ParsedLine, ctx: RuleContext): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const date = inv.meta.date;
  const fact = line.mxik ? ctx.facts?.get(line.mxik) : undefined;

  // §7.17 R:337, §7.5 R:325: a code that lost its leading zero (Excel, a JS number) is proposed back when the padded code exists.
  const padded = line.mxik ? null : leadingZeroCandidate(line.rawCatalogCode);
  if (padded && ctx.facts?.get(padded)?.exists) out.push({ code: 'mxik_leading_zero', severity: 'warning', field: 'mxik', suggestion: padded, params: { value: line.rawCatalogCode ?? '', code: padded } });

  // §7.17 R:337, V1 R:270, V2 R:271: the code exists in the current catalogue and is active on the invoice date.
  if (line.mxik && fact) {
    if (!fact.exists) out.push({ code: 'mxik_not_found', severity: 'error', field: 'mxik', params: { code: line.mxik } });
    else if (fact.retiredAt) {
      const lastDay = addDays(fact.retiredAt, DEACTIVATION_GRACE_DAYS);
      if (date >= lastDay) out.push({ code: 'mxik_inactive', severity: 'error', field: 'mxik', params: { code: line.mxik, retiredAt: fact.retiredAt, date } });
      else out.push({ code: 'mxik_retired_later', severity: 'info', field: 'mxik', params: { code: line.mxik, retiredAt: fact.retiredAt, date } });
    }
    // V9 R:278: generalised codes refused from their list date (building materials from 01.07.2026).
    if (fact.restrictedFrom) {
      out.push(date >= fact.restrictedFrom
        ? { code: 'mxik_restricted', severity: 'error', field: 'mxik', params: { code: line.mxik, from: fact.restrictedFrom } }
        : { code: 'mxik_restricted_later', severity: 'info', field: 'mxik', params: { code: line.mxik, from: fact.restrictedFrom } });
    }
  }

  // §7.18 R:338, V3 R:272: the package is one bound to the code; the unit it stands for is one the code allows.
  if (line.mxik && fact?.exists) {
    if (line.packageCode && fact.packages && fact.packages.length > 0 && !fact.packages.some((p) => p.code === line.packageCode)) {
      out.push({ code: 'package_not_of_code', severity: 'warning', field: 'packageCode', params: { packageCode: line.packageCode, code: line.mxik } });
    }
    const unitId = unitIdOf(line.packageName) ?? unitIdOf(line.unit);
    if (unitId !== null && fact.unitBinding === 'strict' && fact.unitIds.length > 0 && !fact.unitIds.includes(unitId)) {
      out.push({
        code: 'unit_not_of_code', severity: 'warning', field: 'unit',
        params: { unit: line.packageName ?? line.unit ?? '', expected: fact.unitCanonical.join(' / ').slice(0, 200), fixed: fact.unitIds.length === 1 ? 1 : 0 },
      });
    }
  }

  // §7.19 R:339, V4 R:273: MeasureId is forbidden in a 002 body; units travel as package code + name.
  if (inv.docType !== '023' && line.measureId && line.mxik) out.push({ code: 'measure_id_in_invoice', severity: 'info', field: 'measureId', params: { value: line.measureId } });

  // §7.20 R:340, V5 R:274: count ≤ 6 decimals, money and rates ≤ 2; dot separator, no thousands separators.
  const countDigits = fractionDigits(line.didox.raw.count);
  if (countDigits !== null && countDigits > 6) out.push({ code: 'decimals_exceeded', severity: 'warning', field: 'quantity', params: { digits: countDigits, max: 6 } });
  for (const key of MONEY_FIELDS) {
    const d = fractionDigits(line.didox.raw[key]);
    if (d !== null && d > 2) out.push({ code: 'decimals_exceeded', severity: 'warning', field: FIELD_OF[key] ?? key, params: { digits: d, max: 2 } });
  }
  for (const key of ['count', ...MONEY_FIELDS] as const) {
    if (looseNumberFormat(line.didox.raw[key])) { out.push({ code: 'number_format', severity: 'info', field: FIELD_OF[key] ?? key, params: { value: String(line.didox.raw[key]).slice(0, 30) } }); break; }
  }

  // §7.22 R:342, V7 R:276: the rate in force on the date; `withoutvat` only makes sense when the list has VAT.
  if (line.vatRate !== null) {
    const rate = Number(line.vatRate);
    const allowed = vatRatesOn(date);
    if (!allowed.includes(rate)) out.push({ code: 'vat_rate_unexpected', severity: 'warning', field: 'vatRate', params: { rate: line.vatRate, date, expected: allowed.join(', ') } });
  }
  if (line.didox.withoutVat && inv.flags.hasVat === false && line.didox.raw.vatrate !== undefined) {
    out.push({ code: 'withoutvat_without_hasvat', severity: 'info', field: 'vatRate' });
  }

  // §7.24 R:344, V8 R:277: a privilege needs its type and name; the VAT it releases is the rate's share for type 1, 0 for type 2.
  const lgota = line.didox.lgota;
  if (lgota) {
    if (lgota.type !== 1 && lgota.type !== 2) out.push({ code: 'lgota_incomplete', severity: 'warning', field: 'lgota', params: { id: lgota.id, missing: 'type' } });
    else if (!lgota.name) out.push({ code: 'lgota_incomplete', severity: 'info', field: 'lgota', params: { id: lgota.id, missing: 'name' } });
    const amount = readDecimal(line.amount) ?? 0n;
    const stated = readDecimal(lgota.vatSum);
    const rate = BigInt(Math.max(...vatRatesOn(date).filter((r) => r !== 6))) * 1_000_000n;
    const expected = lgota.type === 2 ? 0n : percentOf(amount, rate);
    if (stated !== null && (lgota.type === 1 || lgota.type === 2) && absDiff(tiyin(stated), tiyin(expected)) > 1n) {
      out.push({ code: 'lgota_sum_mismatch', severity: 'warning', field: 'lgota', params: { stated: lgota.vatSum ?? '', expected: toDecimalString(roundTo(expected, 2)) } });
    }
    if (fact?.exists && fact.privilegeIds.length > 0 && !fact.privilegeIds.includes(lgota.id)) {
      out.push({ code: 'lgota_not_of_code', severity: 'info', field: 'lgota', params: { id: lgota.id, code: line.mxik ?? '' } });
    }
  } else if ((line.didox.withoutVat || line.vatRate === '0') && ['20', '21', '22'].includes(inv.parties.seller.vatRegStatus ?? '')) {
    // A VAT payer's 0 % or no-VAT line without a privilege (§7.24).
    out.push({ code: 'vat_free_without_lgota', severity: 'info', field: 'vatRate' });
  }

  // §7.25 R:345, V9 R:278: VAT on these codes cannot be credited; reimbursement invoices use the compensation list.
  if (line.mxik && ctx.lists) {
    if (ctx.lists.notIncluded.has(line.mxik) && line.vatRate !== null && line.vatRate !== '0') out.push({ code: 'vat_not_creditable', severity: 'warning', field: 'vatAmount', params: { code: line.mxik } });
    if (COMPENSATION_TYPES.has(inv.facturaType ?? '') && !ctx.lists.compensation.has(line.mxik)) out.push({ code: 'compensation_code_expected', severity: 'warning', field: 'mxik', params: { code: line.mxik, type: inv.facturaType ?? '' } });
  }

  // §7.27 R:347: origin 1–4; services are origin 3, goods are not.
  const origin = line.didox.origin;
  if (origin !== null && (origin < 1 || origin > 4)) out.push({ code: 'origin_invalid', severity: 'info', field: 'origin', params: { value: origin } });
  else if (origin !== null && line.mxik) {
    const service = isServiceCode(line.mxik);
    if (service !== (origin === 3)) out.push({ code: 'origin_mismatch', severity: 'info', field: 'origin', params: { value: origin, service: service ? 1 : 0 } });
  }

  // §7.28 R:348, V15 R:284: a marked-goods code needs its marks on the line.
  if (line.mxik && fact?.isMarked === true && !line.didox.marked) out.push({ code: 'marks_missing', severity: 'warning', field: 'marks', params: { code: line.mxik } });
  return out;
}

export function invoiceRules(inv: ParsedInvoice, ctx: RuleContext): RuleResult {
  const doc: ValidationIssue[] = [];
  const { meta, flags, parties } = inv;
  const lines = inv.lines.map((l) => lineRules(inv, l, ctx));

  // §7.23 R:343: the list's flags agree with its lines.
  const any = (f: (l: ParsedLine) => boolean): boolean => inv.lines.some(f);
  const flagChecks: Array<[string, boolean | null, boolean]> = [
    ['hasvat', flags.hasVat, any((l) => (readDecimal(l.vatAmount) ?? 0n) > 0n)],
    ['hascommittent', flags.hasCommittent, any((l) => Boolean(l.didox.committent?.tin))],
    ['haslgota', flags.hasLgota, any((l) => Boolean(l.didox.lgota))],
    ['hasmarking', flags.hasMarking, any((l) => l.didox.marked)],
    ['hasexcise', flags.hasExcise, any((l) => (readDecimal(l.didox.exciseSum) ?? 0n) > 0n)],
  ];
  for (const [flag, stated, actual] of flagChecks) {
    if (stated !== null && stated !== actual) doc.push({ code: 'flag_mismatch', severity: flag === 'hasvat' || flag === 'hasmarking' ? 'warning' : 'info', field: `productlist.${flag}`, params: { flag, stated: stated ? 1 : 0, lines: actual ? 1 : 0 } });
  }

  // §7.26 R:346, V10 R:279: parties' identifiers in their formats; VAT status as of the document.
  const oneSided = inv.singleSidedType !== null;
  for (const [role, p] of [['seller', parties.seller], ['buyer', parties.buyer]] as const) {
    if (role === 'buyer') {
      if (!p.present && !oneSided) doc.push({ code: 'buyer_missing', severity: 'warning', field: 'buyer' });
      if (p.rawTin && !/^(\d{9}|\d{14})$/.test(p.rawTin)) doc.push({ code: 'buyer_tin_invalid', severity: 'warning', field: 'buyer.inn', params: { value: p.rawTin } });
    }
    if (!p.present) continue;
    if (p.vatRegCode && !/^\d{12}$/.test(p.vatRegCode)) doc.push({ code: 'vat_reg_code_invalid', severity: 'info', field: `${role}.vatRegCode`, params: { value: p.vatRegCode } });
    if (p.vatRegStatus === '21' || p.vatRegStatus === '22') doc.push({ code: 'vat_status_inactive', severity: 'warning', field: `${role}.vatRegStatus`, params: { status: p.vatRegStatus, role } });
    if (p.bankId && !/^\d{5}$/.test(p.bankId.replace(/\s/g, ''))) {
      const padded = /^\d{1,4}$/.test(p.bankId) ? p.bankId.padStart(5, '0') : null;
      doc.push({ code: 'mfo_invalid', severity: 'info', field: `${role}.mfo`, params: { value: p.bankId }, ...(padded ? { suggestion: padded } : {}) });
    }
    if (p.account && !/^\d{20}$/.test(p.account.replace(/\s/g, ''))) doc.push({ code: 'account_invalid', severity: 'info', field: `${role}.account`, params: { value: p.account } });
    // Only a roaming-shaped party (it carries its VAT registration code) is held to the mandatory director.
    if (!p.director && p.vatRegCode !== null && inv.envelope !== 'factura_2020' && meta.source !== 'xlsx') doc.push({ code: 'director_missing', severity: 'info', field: `${role}.director` });
  }
  // §7.9 R:329: a one-sided invoice has no buyer and names its type.
  if (oneSided) doc.push({ code: 'one_sided', severity: 'info', field: 'singleSidedType', params: { type: inv.singleSidedType ?? 0 } });

  // §7.29 R:349, V13 R:282: a correction names its original; a corrected (type 4) one keeps its number and date.
  const type = inv.facturaType;
  if (type && !FACTURA_TYPES.has(type)) doc.push({ code: 'factura_type_unknown', severity: 'info', field: 'facturaType', params: { value: type } });
  if (type && CORRECTION_TYPES.has(type)) {
    if (!inv.oldFactura) doc.push({ code: 'correction_without_original', severity: 'warning', field: 'oldFacturaDoc', params: { type } });
    else if (ctx.original === null) doc.push({ code: 'correction_original_unknown', severity: 'info', field: 'oldFacturaDoc', params: { number: inv.oldFactura.number ?? '', date: inv.oldFactura.date ?? '' } });
    else if (ctx.original && type === '4' && (ctx.original.number !== meta.number || ctx.original.date !== meta.date)) {
      doc.push({ code: 'correction_number_changed', severity: 'info', field: 'facturaDoc', params: { original: `${ctx.original.number} / ${ctx.original.date}` } });
    }
  } else if (type === '0' && inv.oldFactura) {
    doc.push({ code: 'old_factura_on_standard', severity: 'info', field: 'oldFacturaDoc' });
  }

  // §7.31 R:351: the date is not in the future and not before the contract; lot ids carry their prefix.
  if (meta.date > ctx.today) doc.push({ code: 'date_in_future', severity: 'warning', field: 'date', params: { date: meta.date } });
  if (meta.contractDate && meta.date < meta.contractDate) doc.push({ code: 'date_before_contract', severity: 'warning', field: 'date', params: { date: meta.date, contractDate: meta.contractDate } });
  if (inv.lotId && !/^(SHAFFOF|CPR|XT)-/i.test(inv.lotId)) doc.push({ code: 'lot_id_format', severity: 'info', field: 'lotId', params: { value: inv.lotId } });

  // §7.32 R:352, §7.13 R:333: a cancelled, deleted, annulled or rejected document is not booked; Didox's comment is shown as sent.
  if (meta.didoxStatus) doc.push(...statusIssues(inv.docType, meta.didoxStatus, inv.statusComment ?? ''));
  return { document: doc, lines };
}

/** The issue codes statusIssues writes: a later status replaces them (connection.ts follows Didox's status changes). */
export const STATUS_ISSUES: ReadonlySet<string> = new Set(['didox_status_void', 'didox_not_signed']);

/** The document issue a Didox status gives: void (an error, the invoice is not booked) or not signed yet (info). */
export function statusIssues(docType: string | null, status: string, comment: string): ValidationIssue[] {
  const { state } = statusInfo(docType, status);
  if (['deleted', 'cancelled', 'invalid', 'annulled', 'rejected'].includes(state)) return [{ code: 'didox_status_void', severity: 'error', field: 'didoxStatus', params: { status, state, comment } }];
  if (state === 'draft' || state === 'pending' || state === 'agent') return [{ code: 'didox_not_signed', severity: 'info', field: 'didoxStatus', params: { status, state, comment } }];
  return [];
}

// What an export of a batch would contain: which records go, which are left out and why, the
// issues found on the way and the checks the format allows (bank: the balance reconciles;
// invoice: the lines add up to the header). Pure: the caller loads the batch, its records and the
// org's earlier exports (export.ts) and decides what to write.
import { createHash } from 'node:crypto';
import { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { mulMicros, near, sum, toMicros, fromMicros } from './decimal.js';
import { normalizeName } from './normalize.js';

type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
export type OneCFormat = z.infer<typeof accounting.ImportOutcome>['format'];
export type ImportKind = (typeof accounting.IMPORT_KINDS)[number];
type RecordStatus = (typeof accounting.RECORD_STATUSES)[number];
type BankTransaction = z.infer<typeof accounting.BankTransaction>;
type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;

export type PlanRecord = {
  id: string;
  rowIndex: number;
  status: RecordStatus;
  payload: unknown;
  issues: ValidationIssue[];
  fingerprint: string | null;
  decision: { action?: string } | null;
};

export type PlanBatch = { id: string; kind: ImportKind; meta: unknown };

/** A record that goes into the file, with its payload parsed for the format. */
export type Included =
  | { record: PlanRecord; kind: 'bank_statement'; payload: BankTransaction }
  | { record: PlanRecord; kind: 'didox_invoice'; payload: InvoiceLine }
  | { record: PlanRecord; kind: 'product_catalog'; payload: ProductRecord };

/** Machine reasons of RecordOutcome.reason for a record left out. */
export type SkipReason = 'unresolved' | 'not_approved' | 'skipped' | 'invalid' | 'duplicate_row' | 'duplicate_export';

export type Plan = {
  primary: boolean;
  included: Included[];
  left: { record: PlanRecord; reason: SkipReason }[];
  issues: ValidationIssue[];
  checks: ImportOutcome['checks'];
  /** SHA-256 of the included records' fingerprints (or ids), sorted. */
  recordSetHash: string;
};

/** Earlier exports the plan compares with: exported records of other batches, by fingerprint. */
export type Prior = { exportedElsewhere: ReadonlyMap<string, { batchId: string }> };

const MAX_ISSUES = 1000;

export function formatAllowed(kind: ImportKind, format: OneCFormat): boolean {
  return format === 'odata' || (accounting.ONEC_FORMATS_BY_KIND[kind] as readonly string[]).includes(format);
}

/** The primary format of a kind (and a direct transfer) moves records to exported; the others are side files. */
export function isPrimary(kind: ImportKind, format: OneCFormat): boolean {
  return format === 'odata' || accounting.PRIMARY_FORMAT[kind] === format;
}

export function setHash(records: readonly PlanRecord[]): string {
  const keys = records.map((r) => r.fingerprint ?? `id:${r.id}`).sort();
  return createHash('sha256').update(keys.join('\n')).digest('hex');
}

const realDate = (iso: string): boolean => {
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/** Zod paths → the generic issue code a reviewer understands. */
function codeForPath(path: (string | number)[]): string {
  const key = path.join('.');
  if (/(^|\.)(date|valueDate)$/.test(key)) return 'date_invalid';
  if (/(^|\.)(amount|price|quantity|total|vatAmount|vatRate)$/.test(key)) return 'amount_invalid';
  if (/(^|\.)(account|ourAccount|mfo)$/.test(key)) return 'account_invalid';
  if (/(^|\.)inn$/.test(key)) return 'inn_invalid';
  if (/(^|\.)name$/.test(key)) return 'name_missing';
  return 'payload_invalid';
}

const issue = (code: string, severity: ValidationIssue['severity'], record: PlanRecord | null, field?: string, params: Record<string, string | number> = {}): ValidationIssue => ({
  code, severity, ...(field ? { field } : {}),
  params: record ? { row: record.rowIndex + 1, recordId: record.id, ...params } : params,
});

/** Format checks of one record; errors keep it out of the file. */
function recordIssues(batch: PlanBatch, rec: PlanRecord, format: OneCFormat): { issues: ValidationIssue[]; parsed: Included | null } {
  const schema = accounting.RECORD_SCHEMAS[batch.kind];
  const parsed = schema.safeParse(rec.payload);
  if (!parsed.success) {
    const seen = new Set<string>();
    const issues = parsed.error.issues.flatMap((e) => {
      const code = codeForPath(e.path);
      const field = e.path.join('.');
      if (seen.has(code + field)) return [];
      seen.add(code + field);
      return [issue(code, 'error', rec, field)];
    });
    return { issues, parsed: null };
  }
  const out: ValidationIssue[] = [];
  if (batch.kind === 'bank_statement') {
    const t = parsed.data as BankTransaction;
    if (!realDate(t.date)) out.push(issue('date_invalid', 'error', rec, 'date'));
    if ((toMicros(t.amount) ?? 0n) <= 0n) out.push(issue('amount_invalid', 'error', rec, 'amount'));
    if (format === 'bank_exchange_1_02' || format === 'odata') {
      const meta = accounting.BankStatementMeta.safeParse(batch.meta);
      if (!t.ourAccount && !(meta.success && meta.data.account)) out.push(issue('account_invalid', 'error', rec, 'ourAccount'));
      const cp = t.counterparty;
      if (!cp.counterpartyId && cp.match?.status === 'ambiguous') out.push(issue('counterparty_ambiguous', 'warning', rec, 'counterparty', { name: cp.name }));
      else if (!cp.counterpartyId && (cp.inn || cp.account || normalizeName(cp.name))) out.push(issue('counterparty_unknown', 'warning', rec, 'counterparty', { name: cp.name }));
    }
    return { issues: out, parsed: { record: rec, kind: 'bank_statement', payload: t } };
  }
  if (batch.kind === 'didox_invoice') {
    const l = parsed.data as InvoiceLine;
    if (!l.name.trim() && !l.resolved?.name.trim()) out.push(issue('name_missing', 'error', rec, 'name'));
    if ((toMicros(l.quantity) ?? 0n) <= 0n) out.push(issue('amount_invalid', 'error', rec, 'quantity'));
    const amount = toMicros(l.amount) ?? 0n;
    if (amount < 0n) out.push(issue('amount_invalid', 'error', rec, 'amount'));
    // Price × quantity against the line amount: a warning (Didox rounds per line).
    const expected = mulMicros(toMicros(l.quantity) ?? 0n, toMicros(l.price) ?? 0n);
    if (!near(expected, amount, 10_000n * 100n)) out.push(issue('totals_mismatch', 'warning', rec, 'amount', { expected: fromMicros(expected), actual: l.amount }));
    if (l.total !== null) {
      const withVat = amount + (toMicros(l.vatAmount) ?? 0n);
      if (!near(withVat, toMicros(l.total) ?? 0n)) out.push(issue('totals_mismatch', 'warning', rec, 'total', { expected: fromMicros(withVat), actual: l.total }));
    }
    return { issues: out, parsed: { record: rec, kind: 'didox_invoice', payload: l } };
  }
  const p = parsed.data as ProductRecord;
  if (!p.name.trim()) out.push(issue('name_missing', 'error', rec, 'name'));
  return { issues: out, parsed: { record: rec, kind: 'product_catalog', payload: p } };
}

/** Approved = valid or corrected (an approved suspicious record becomes one of the two). */
const approved = (r: PlanRecord): boolean => r.status === 'valid' || r.status === 'corrected';

/** opening + credits − debits = closing, and the statement's own totals, over every record of the statement. */
function bankChecks(batch: PlanBatch, all: readonly PlanRecord[], issues: ValidationIssue[]): ImportOutcome['checks'] {
  const meta = accounting.BankStatementMeta.partial().safeParse(batch.meta);
  const m = meta.success ? meta.data : {};
  const lines = all.flatMap((r) => {
    const t = accounting.BankTransaction.safeParse(r.payload);
    return t.success ? [t.data] : [];
  });
  const credits = sum(lines.filter((t) => t.direction === 'credit').map((t) => t.amount));
  const debits = sum(lines.filter((t) => t.direction === 'debit').map((t) => t.amount));
  const checks: ImportOutcome['checks'] = [];
  const opening = toMicros(m.openingBalance ?? null);
  const closing = toMicros(m.closingBalance ?? null);
  if (opening !== null && closing !== null) {
    const computed = opening + credits - debits;
    const ok = near(computed, closing);
    const detail = `${fromMicros(opening)} + ${fromMicros(credits)} − ${fromMicros(debits)} = ${fromMicros(computed)}; ${fromMicros(closing)}`;
    checks.push({ code: 'balance', ok, detail });
    if (!ok) issues.push(issue('balance_mismatch', 'warning', null, undefined, { expected: fromMicros(closing), actual: fromMicros(computed) }));
  }
  const td = toMicros(m.totalDebit ?? null);
  const tc = toMicros(m.totalCredit ?? null);
  if (td !== null || tc !== null) {
    const ok = (td === null || near(td, debits)) && (tc === null || near(tc, credits));
    checks.push({ code: 'turnover', ok, detail: `${fromMicros(credits)} / ${fromMicros(debits)}` });
    if (!ok) issues.push(issue('balance_mismatch', 'warning', null, undefined, { expected: `${fromMicros(tc ?? 0n)} / ${fromMicros(td ?? 0n)}`, actual: `${fromMicros(credits)} / ${fromMicros(debits)}` }));
  }
  return checks;
}

/** The lines (all of them, as the document has them) add up to the invoice header. */
function invoiceChecks(batch: PlanBatch, all: readonly PlanRecord[], issues: ValidationIssue[]): ImportOutcome['checks'] {
  const meta = accounting.IncomingInvoiceMeta.safeParse(batch.meta);
  if (!meta.success) return [];
  const lines = all.flatMap((r) => {
    const l = accounting.InvoiceLine.safeParse(r.payload);
    return l.success ? [l.data] : [];
  });
  const amount = sum(lines.map((l) => l.amount));
  const vat = sum(lines.map((l) => l.vatAmount));
  const total = sum(lines.map((l) => l.total ?? fromMicros((toMicros(l.amount) ?? 0n) + (toMicros(l.vatAmount) ?? 0n))));
  const h = meta.data;
  // A rounding per line is allowed: one tiyin per line.
  const tolerance = 10_000n * BigInt(Math.max(1, lines.length));
  const pairs: [string, bigint, string | null][] = [['amount', amount, h.totalAmount], ['vat', vat, h.totalVat], ['total', total, h.totalWithVat]];
  const failed = pairs.filter(([, got, want]) => want !== null && !near(got, toMicros(want) ?? 0n, tolerance));
  const ok = failed.length === 0;
  for (const [field, got, want] of failed) issues.push(issue('totals_mismatch', 'warning', null, field, { expected: want ?? '', actual: fromMicros(got) }));
  return [{ code: 'totals', ok, detail: `${fromMicros(amount)} + ${fromMicros(vat)} = ${fromMicros(total)}; ${h.totalWithVat}` }];
}

/**
 * The plan for `format`. Without `recordIds` the batch's approved records go; with them, those
 * records (an explicit choice may re-send an exported one: the same set exported earlier is then a
 * warning, not a refusal). Records with an error after the format checks, duplicates within the
 * set and records already exported from another batch of the org are left out with the reason.
 */
export function planExport(batch: PlanBatch, records: readonly PlanRecord[], format: OneCFormat, recordIds: readonly string[] | undefined, prior: Prior): Plan {
  const primary = isPrimary(batch.kind, format);
  const issues: ValidationIssue[] = [];
  const left: Plan['left'] = [];
  const wanted = recordIds ? new Set(recordIds) : null;
  const candidates: PlanRecord[] = [];
  for (const r of records) {
    if (wanted && !wanted.has(r.id)) continue;
    if (!wanted && r.status === 'exported') continue;
    if (r.status === 'skipped') left.push({ record: r, reason: 'skipped' });
    else if (r.status === 'unresolved') left.push({ record: r, reason: 'unresolved' });
    else if (r.status === 'suspicious') left.push({ record: r, reason: 'not_approved' });
    else if (approved(r) || r.status === 'exported') candidates.push(r);
  }
  const awaiting = left.filter((l) => l.reason !== 'skipped').length;
  if (awaiting > 0) issues.push(issue('unresolved', 'warning', null, undefined, { count: awaiting }));

  const included: Included[] = [];
  const seen = new Map<string, PlanRecord>();
  for (const r of candidates) {
    const checked = recordIssues(batch, r, format);
    if (issues.length < MAX_ISSUES) issues.push(...checked.issues);
    if (!checked.parsed || checked.issues.some((i) => i.severity === 'error')) {
      left.push({ record: r, reason: 'invalid' });
      continue;
    }
    if (primary && r.fingerprint) {
      const first = seen.get(r.fingerprint);
      if (first) {
        issues.push(issue('duplicate_row', 'error', r, undefined, { of: first.rowIndex + 1 }));
        left.push({ record: r, reason: 'duplicate_row' });
        continue;
      }
      seen.set(r.fingerprint, r);
      const elsewhere = prior.exportedElsewhere.get(r.fingerprint);
      if (elsewhere && elsewhere.batchId !== batch.id) {
        issues.push(issue('duplicate_export', 'error', r, undefined, { batchId: elsewhere.batchId }));
        left.push({ record: r, reason: 'duplicate_export' });
        continue;
      }
    }
    included.push(checked.parsed);
  }

  const checks: ImportOutcome['checks'] = [];
  if (batch.kind === 'bank_statement') checks.push(...bankChecks(batch, records, issues));
  if (batch.kind === 'didox_invoice') checks.push(...invoiceChecks(batch, records, issues));
  const dupes = left.filter((l) => l.reason === 'duplicate_row' || l.reason === 'duplicate_export').length;
  checks.push({ code: 'duplicates', ok: dupes === 0, detail: String(dupes) });
  checks.push({ code: 'review', ok: awaiting === 0, detail: String(awaiting) });
  checks.push({ code: 'records', ok: included.length > 0, detail: String(included.length) });
  return { primary, included, left, issues: issues.slice(0, MAX_ISSUES), checks, recordSetHash: setHash(included.map((i) => i.record)) };
}

/** The same set of records was exported before (same format): a warning on the plan, not a refusal. */
export function flagSameSet(plan: Plan, earlier: { exportId: string; createdAt: string }): Plan {
  if (plan.included.length === 0) return plan;
  return {
    ...plan,
    issues: [...plan.issues, issue('duplicate_export', 'warning', null, undefined, { exportId: earlier.exportId, at: earlier.createdAt })],
    checks: plan.checks.map((c) => (c.code === 'duplicates' ? { ...c, ok: false } : c)),
  };
}

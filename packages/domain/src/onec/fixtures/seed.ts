// Creates import batches from the fixtures, the way a producing workstream would: records with
// fingerprints, issues and statuses, the batch's counts. Used by the 1C tests, the benchmark and
// scripts/seed-accounting-demo.ts (so every workstream and the QA can open a batch on /onec).
import { randomBytes } from 'node:crypto';
import type { Prisma, RecordStatus } from '@prisma/client';
import type { accounting } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import type { z } from 'zod';
import { refreshCounts, statusFromIssues } from '../batch-state.js';
import { fromMicros, toMicros } from '../decimal.js';
import { bankFingerprint, invoiceLineFingerprint, productFingerprint } from '../fingerprint.js';
import { BANK_META, BANK_TRANSACTIONS, INVOICE_LINES, INVOICE_META, OUR_ACCOUNT, PRODUCTS } from './demo-data.js';

type BankTransaction = z.infer<typeof accounting.BankTransaction>;
type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;

type SeedRecord = { payload: unknown; issues?: ValidationIssue[]; fingerprint: string | null; status?: RecordStatus };

export type SeedOptions = { orgId: string; clientId?: string | null; createdBy?: string | null; filename?: string; source?: string };

async function createBatch(
  kind: 'bank_statement' | 'didox_invoice' | 'product_catalog', meta: unknown, records: SeedRecord[], o: SeedOptions & { externalRef?: string | null },
): Promise<string> {
  const batch = await db.importBatch.create({
    data: {
      orgId: o.orgId, clientId: o.clientId ?? null, kind, source: o.source ?? 'upload', filename: o.filename ?? null, externalRef: o.externalRef ?? null,
      fingerprint: randomBytes(16).toString('hex'), status: 'review', meta: meta as Prisma.InputJsonValue, createdBy: o.createdBy ?? null,
    },
    select: { id: true },
  });
  const rows = records.map((r, rowIndex) => ({
    batchId: batch.id, rowIndex, payload: r.payload as Prisma.InputJsonValue, issues: r.issues ?? [], fingerprint: r.fingerprint,
    status: r.status ?? statusFromIssues(r.issues ?? []),
  }));
  for (let i = 0; i < rows.length; i += 1000) await db.importRecord.createMany({ data: rows.slice(i, i + 1000) });
  const counts = await refreshCounts(batch.id);
  await db.importBatch.update({ where: { id: batch.id }, data: { status: counts.unresolved + counts.suspicious > 0 ? 'review' : 'approved' } });
  return batch.id;
}

export type BankSeed = { transactions?: readonly BankTransaction[]; meta?: typeof BANK_META; issues?: Record<number, ValidationIssue[]> };

/** The fixture statement (six payments, one of them a bank fee without a counterparty), with the issues a parser would have raised. */
export async function seedBankBatch(o: SeedOptions, seed: BankSeed = {}): Promise<string> {
  const { transactions = BANK_TRANSACTIONS, meta = BANK_META, issues = {} } = seed;
  return createBatch('bank_statement', meta, transactions.map((t, i) => ({ payload: t, fingerprint: bankFingerprint(t, meta.account), issues: issues[i] ?? [] })), {
    filename: 'vypiska-oktyabr.xlsx', ...o,
  });
}

/** `n` synthetic payments that still reconcile (for the 1 000-record benchmark). */
export function syntheticTransactions(n: number, salt = ''): { transactions: BankTransaction[]; meta: typeof BANK_META } {
  const transactions: BankTransaction[] = [];
  let credits = 0n;
  let debits = 0n;
  for (let i = 0; i < n; i++) {
    const credit = i % 3 !== 0;
    const amount = `${100_000 + ((i * 7919) % 900_000)}.${String(i % 100).padStart(2, '0')}`;
    if (credit) credits += toMicros(amount) ?? 0n;
    else debits += toMicros(amount) ?? 0n;
    const inn = String(300_000_000 + (i % 250));
    transactions.push({
      date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`, docNumber: `${salt}${i + 1}`, direction: credit ? 'credit' : 'debit', amount, currency: 'UZS',
      ourAccount: OUR_ACCOUNT,
      counterparty: { name: `ООО «Контрагент ${i % 250}»`, inn, account: `2020800${String(i % 250).padStart(13, '0')}`, mfo: '00444', counterpartyId: null },
      purpose: `Оплата по счёту №${i + 1} от ${1 + (i % 28)}.10.2026`, reference: null, valueDate: null, operation: null, cashFlowItem: null, contract: null, decidedBy: null,
    });
  }
  const opening = 50_000_000_000_000n;
  return {
    transactions,
    meta: {
      ...BANK_META, periodFrom: '2026-10-01', periodTo: '2026-10-28', openingBalance: fromMicros(opening), closingBalance: fromMicros(opening + credits - debits),
      totalCredit: fromMicros(credits), totalDebit: fromMicros(debits),
    },
  };
}

/** The fixture invoice: four lines; line 4 (a service) has no MXIK. */
export async function seedInvoiceBatch(o: SeedOptions, meta = INVOICE_META, issues: Record<number, ValidationIssue[]> = {}): Promise<string> {
  return createBatch('didox_invoice', meta, INVOICE_LINES.map((l, i) => ({ payload: l, fingerprint: invoiceLineFingerprint(meta, l), issues: issues[i] ?? [] })), {
    filename: `${meta.number}.json`, source: 'didox_zip', externalRef: meta.externalId, ...o,
  });
}

/** The fixture catalogue: three products, the third without an MXIK (a warning the products workstream would raise). */
export async function seedProductBatch(o: SeedOptions): Promise<string> {
  return createBatch('product_catalog', { source: 'xlsx', headers: ['Наименование', 'ИКПУ'], columnMap: { name: 0, mxik: 1 }, catalogId: null },
    PRODUCTS.map((p) => ({
      payload: p, fingerprint: productFingerprint(p),
      issues: p.mxik ? [] : [{ code: 'mxik_missing', severity: 'warning' as const, field: 'mxik' }],
    })), { filename: 'tovary.xlsx', ...o });
}

// The per-record duplicate key (import_record.fingerprint) the schema describes, in one place so
// every producer computes it the same way and the 1C layer's duplicate checks find them:
// bank = date + amount + our account + direction + document number (+ counterparty account when
// there is no number); invoice line = the invoice's external ref (or number + date + seller ИНН) +
// line number; product = normalised name + unit. Pure.
import { createHash } from 'node:crypto';
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { fromMicros, toMicros } from './decimal.js';
import { normalizeName } from './normalize.js';

type BankTransaction = z.infer<typeof accounting.BankTransaction>;
type InvoiceLine = z.infer<typeof accounting.InvoiceLine>;
type IncomingInvoiceMeta = z.infer<typeof accounting.IncomingInvoiceMeta>;
type ProductRecord = z.infer<typeof accounting.ProductRecord>;

const hash = (parts: (string | number | null | undefined)[]): string => createHash('sha256').update(parts.map((p) => p ?? '').join('|')).digest('hex').slice(0, 40);
/** "1500", "1500.0" and "1500.00" are the same amount. */
const amountKey = (a: string | null): string => { const m = toMicros(a); return m === null ? a ?? '' : fromMicros(m); };

export function bankFingerprint(t: BankTransaction, statementAccount: string | null = null): string {
  const number = t.docNumber?.trim() || null;
  return hash(['bank', t.date, amountKey(t.amount), t.ourAccount ?? statementAccount, t.direction, number, number ? null : t.counterparty.account ?? t.purpose.slice(0, 80)]);
}

export function invoiceLineFingerprint(meta: Pick<IncomingInvoiceMeta, 'externalId' | 'number' | 'date' | 'seller'>, line: Pick<InvoiceLine, 'lineNo'>): string {
  return hash(['invoice', meta.externalId ?? `${meta.number}|${meta.date}|${meta.seller.inn ?? normalizeName(meta.seller.name)}`, line.lineNo]);
}

export function productFingerprint(p: Pick<ProductRecord, 'name' | 'unit'>): string {
  return hash(['product', normalizeName(p.name), (p.unit ?? '').trim().toLowerCase()]);
}

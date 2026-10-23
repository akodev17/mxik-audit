// Per-line duplicate keys. A statement line is the same payment as another when its bank
// reference is the same (when the file has references); otherwise the 1C layer's bankFingerprint
// decides (date, amount, the org's account, direction, document number — and the counterparty's
// account or the purpose when there is no number), so the bank module, the 1C exporter and the
// demo seed share one key. The 1C layer reads the stored key; it never recomputes it. Pure.
import { createHash } from 'node:crypto';
import type { BankRecordPayload } from '@tasnivo/contracts/modules/bank';
import { bankFingerprint } from '../onec/fingerprint.js';

type Line = Pick<BankRecordPayload, 'date' | 'amount' | 'direction' | 'ourAccount' | 'docNumber' | 'reference' | 'counterparty' | 'purpose'>;

/** The line's duplicate key; null for a line without date, amount or direction (it cannot be compared). */
export function lineFingerprint(line: Line): string | null {
  const reference = line.reference?.trim();
  // bankFingerprint ignores the bank's own reference, the strongest identity a file can give.
  if (reference) return createHash('sha256').update(['ref', line.ourAccount ?? '', reference].join('|')).digest('hex');
  if (!line.date || !line.amount || !line.direction) return null;
  return bankFingerprint({
    date: line.date, amount: line.amount, direction: line.direction, ourAccount: line.ourAccount, docNumber: line.docNumber,
    counterparty: { ...line.counterparty }, purpose: line.purpose,
    currency: 'UZS', reference: null, valueDate: null, operation: null, cashFlowItem: null, contract: null, decidedBy: null,
  });
}

/** For each line, the earlier line of the same file with the same key (its index), or -1. */
export function duplicatesInFile(fingerprints: readonly (string | null)[]): number[] {
  const first = new Map<string, number>();
  return fingerprints.map((f, i) => {
    if (f === null) return -1;
    const seen = first.get(f);
    if (seen === undefined) { first.set(f, i); return -1; }
    return seen;
  });
}

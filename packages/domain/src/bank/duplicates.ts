// Per-line duplicate keys. A statement line is the same payment as another when its bank
// reference is the same (when the file has references), else when date, amount, direction, the
// org's account, the document number and the counterparty's ИНН all are. Pure.
import { createHash } from 'node:crypto';
import type { BankRecordPayload } from '@tasnivo/contracts/modules/bank';

type Line = Pick<BankRecordPayload, 'date' | 'amount' | 'direction' | 'ourAccount' | 'docNumber' | 'reference' | 'counterparty'>;

/** The line's duplicate key (SHA-256 hex); null for a line without date, amount or direction (it cannot be compared). */
export function lineFingerprint(line: Line): string | null {
  const reference = line.reference?.trim();
  let key: string;
  if (reference) key = ['ref', line.ourAccount ?? '', reference].join('|');
  else {
    if (!line.date || !line.amount || !line.direction) return null;
    key = [line.date, line.amount, line.direction, line.ourAccount ?? '', (line.docNumber ?? '').trim().toLowerCase(), line.counterparty.inn ?? ''].join('|');
  }
  return createHash('sha256').update(key).digest('hex');
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

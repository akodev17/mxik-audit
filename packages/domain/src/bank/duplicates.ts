// Per-line duplicate keys. A statement line is the same payment as another when its bank
// reference is the same (when the file has references); otherwise when its own account, date,
// direction, document number, amount, counterparty account and purpose agree (bank research
// §7.42; §7.24 for kl_to_1c). The counterparty account and the purpose are always part of the key:
// Uzbek banks reuse small document numbers (`Номер=1` on several bank orders a day), so the
// number alone — 1C's own check (research §4 pitfall 2) — would merge different payments. The
// purpose is compared normalised (case, spacing, punctuation, Uzbek letters folded as kl_to_1c
// writes them), so the same payment read from the bank's Excel and from its kl_to_1c.txt agrees.
// The 1C layer reads the stored key; it never recomputes it. Pure.
import { createHash } from 'node:crypto';
import type { BankRecordPayload } from '@tasnivo/contracts/modules/bank';
import { toUnits } from './decimal.js';

type Line = Pick<BankRecordPayload, 'date' | 'amount' | 'direction' | 'ourAccount' | 'docNumber' | 'reference' | 'counterparty' | 'purpose'>;

const FOLD: Record<string, string> = { 'ғ': 'г', 'қ': 'к', 'ў': 'у', 'ҳ': 'х', 'ё': 'е' };

/** The purpose as compared: lower case, Uzbek letters folded, only letters and digits, first 120 kept. */
export function purposeKey(purpose: string): string {
  return purpose.toLowerCase().replace(/[ғқўҳё]/g, (c) => FOLD[c] ?? c).replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 120);
}

const sha = (parts: readonly string[]): string => createHash('sha256').update(parts.join('|')).digest('hex');

/** The line's duplicate key; null for a line without date, amount or direction (it cannot be compared). */
export function lineFingerprint(line: Line): string | null {
  const reference = line.reference?.trim();
  if (reference) return sha(['ref', line.ourAccount ?? '', reference]);
  if (!line.date || !line.amount || !line.direction) return null;
  return sha([
    'bank2', line.ourAccount ?? '', line.date, line.direction, line.docNumber?.trim().replace(/^0+(?=\d)/, '') ?? '',
    toUnits(line.amount).toString(), line.counterparty.account ?? '', sha([purposeKey(line.purpose)]).slice(0, 16),
  ]).slice(0, 40);
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

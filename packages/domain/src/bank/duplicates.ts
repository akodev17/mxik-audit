// Per-line duplicate keys. A statement line is the same payment as another when its bank
// reference is the same (when the file has references); otherwise when its own account, date,
// direction, amount and document number agree (without a number: its counterparty account and
// purpose) — the stored key — AND the two lines do not contradict each other: written counterparty
// accounts must be equal, and with no account on either side the purposes must agree (bank
// research §7.24, §7.42). Uzbek banks reuse small numbers (`Номер=1` on several documents a day),
// so the number alone — 1C's own check (research §4 pitfall 2) — would merge different payments;
// but a re-export of the same statement in another format may leave out the counterparty account
// or shorten the purpose, so those two only separate lines that both carry them. Purposes are
// compared normalised (case, spacing, punctuation, Uzbek letters folded as kl_to_1c writes them).
// The 1C layer reads the stored key; it never recomputes it. Pure.
import { createHash } from 'node:crypto';
import type { BankRecordPayload } from '@tasnivo/contracts/modules/bank';
import { toUnits } from './decimal.js';

export type DuplicateLine = Pick<BankRecordPayload, 'date' | 'amount' | 'direction' | 'ourAccount' | 'docNumber' | 'reference' | 'counterparty' | 'purpose'>;

const FOLD: Record<string, string> = { 'ғ': 'г', 'қ': 'к', 'ў': 'у', 'ҳ': 'х', 'ё': 'е' };

/** The purpose as compared: lower case, Uzbek letters folded, only letters and digits, the first 120 kept. */
export function purposeKey(purpose: string): string {
  return purpose.toLowerCase().replace(/[ғқўҳё]/g, (c) => FOLD[c] ?? c).replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 120);
}

const sha = (parts: readonly string[]): string => createHash('sha256').update(parts.join('|')).digest('hex');
/** "00012" and the 12 an Excel number cell made of it are one document number (§7.35). */
const numberKey = (n: string | null): string => n?.trim().replace(/^0+(?=\d)/, '') ?? '';

/** The line's duplicate key; null for a line without date, amount or direction (it cannot be compared). */
export function lineFingerprint(line: DuplicateLine): string | null {
  const reference = line.reference?.trim();
  if (reference) return sha(['ref', line.ourAccount ?? '', reference]);
  if (!line.date || !line.amount || !line.direction) return null;
  const number = numberKey(line.docNumber);
  return sha([
    'bank2', line.ourAccount ?? '', line.date, line.direction, toUnits(line.amount).toString(), number,
    number ? '' : line.counterparty.account ?? '', number ? '' : purposeKey(line.purpose),
  ]).slice(0, 40);
}

/** Two lines of one key are one payment unless what both of them write tells them apart. */
export function sameLine(a: DuplicateLine, b: DuplicateLine): boolean {
  const ca = a.counterparty.account;
  const cb = b.counterparty.account;
  if (ca && cb) return ca === cb;
  if (ca || cb) return true;
  const pa = purposeKey(a.purpose);
  const pb = purposeKey(b.purpose);
  return !pa || !pb || pa === pb;
}

/** For each line, the earlier line of the same file that is the same payment (its index), or -1. */
export function duplicatesInFile(fingerprints: readonly (string | null)[], lines?: readonly DuplicateLine[]): number[] {
  const seen = new Map<string, number[]>();
  return fingerprints.map((f, i) => {
    if (f === null) return -1;
    const earlier = seen.get(f) ?? [];
    const line = lines?.[i];
    const twin = earlier.find((j) => !line || !lines?.[j] || sameLine(line, lines[j]));
    earlier.push(i);
    seen.set(f, earlier);
    return twin ?? -1;
  });
}

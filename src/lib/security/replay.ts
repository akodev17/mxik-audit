// One-time use of a signed value (a Telegram login hash): the first request wins, a replay is refused.
import { db } from '../db.js';
import { attemptKey } from './rate-limit.js';

/** True only for the first claim of `value`. Every claim writes a row; the earliest row wins, so two racing claims cannot both pass. */
export async function claimOnce(kind: string, value: string): Promise<boolean> {
  const key = attemptKey(value);
  const mine = await db.authAttempt.create({ data: { kind, key }, select: { id: true } });
  const first = await db.authAttempt.findFirst({ where: { kind, key }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } });
  return first?.id === mine.id;
}

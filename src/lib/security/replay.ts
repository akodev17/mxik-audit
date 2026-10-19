// One-time use of a signed value (a Telegram login hash): the first request wins, a replay is refused.
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { attemptKey } from './rate-limit.js';

/** Kinds backed by the partial unique index auth_attempt_once_key. */
export type OnceKind = 'tg_replay';

/** True only for the first claim of `value`; the unique index makes racing claims fail atomically. */
export async function claimOnce(kind: OnceKind, value: string): Promise<boolean> {
  const id = `once_${randomBytes(12).toString('hex')}`;
  const inserted = await db.$executeRaw`
    INSERT INTO auth_attempt (id, kind, key) VALUES (${id}, ${kind}, ${attemptKey(value)})
    ON CONFLICT (kind, key) WHERE kind = 'tg_replay' DO NOTHING`;
  return inserted === 1;
}

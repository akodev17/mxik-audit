// Six-digit codes that confirm an e-mail address. Only a keyed hash is stored (the code alone has
// too little entropy for a plain hash); each code expires, allows a few wrong entries, and a new
// code retires the earlier ones, so only the newest mail counts.
import { randomInt } from 'node:crypto';
import { db } from '@tasnivo/db';
import { safeEqualText } from './safe-equal.js';
import { keyedHash } from './secret.js';

export const CODE_DIGITS = 6;
export const CODE_MINUTES = 15;
/** Wrong entries one code allows; then a new code must be requested. */
export const CODE_TRIES = 5;

const codeHash = (userId: string, code: string): string => keyedHash('email-code', `${userId}:${code}`);

/** Only digits, exactly CODE_DIGITS of them (spaces and dashes a person may type are dropped). */
export function normalizeCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${CODE_DIGITS}}$`).test(digits) ? digits : null;
}

/** A fresh code for the user; earlier unused codes stop working. Answers the code to mail. */
export async function issueCode(userId: string, now = new Date()): Promise<string> {
  const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0');
  await db.$transaction([
    db.emailCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
    db.emailCode.create({ data: { userId, codeHash: codeHash(userId, code), expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000), createdAt: now } }),
  ]);
  return code;
}

/** 'ok' uses the code up; 'expired' also covers "no code was sent" and "already used". */
export type CodeCheck = 'ok' | 'wrong' | 'expired' | 'locked';

/**
 * Checks the user's newest code. Every entry is counted before the comparison and the count is
 * capped in the same statement, so parallel guesses cannot get more than CODE_TRIES tries.
 */
export async function checkCode(userId: string, input: string, now = new Date()): Promise<CodeCheck> {
  const row = await db.emailCode.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!row || row.expiresAt <= now) return 'expired';
  const counted = await db.emailCode.updateMany({ where: { id: row.id, usedAt: null, attempts: { lt: CODE_TRIES } }, data: { attempts: { increment: 1 } } });
  if (counted.count !== 1) return 'locked';
  const code = normalizeCode(input);
  if (code && safeEqualText(codeHash(userId, code), row.codeHash)) {
    const used = await db.emailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
    return used.count === 1 ? 'ok' : 'expired';
  }
  return row.attempts + 1 >= CODE_TRIES ? 'locked' : 'wrong';
}

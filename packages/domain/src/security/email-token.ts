// One-time links sent by e-mail. Only a hash of the token is stored; each token has one purpose.
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@tasnivo/db';

export type TokenPurpose = 'verify' | 'reset';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** A fresh token; earlier unused tokens of the same purpose stop working, so only the newest link counts. */
export async function issueToken(userId: string, purpose: TokenPurpose, ttlMs: number, now = new Date()): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await db.$transaction([
    db.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: now } }),
    db.emailToken.create({ data: { userId, purpose, tokenHash: hash(token), expiresAt: new Date(now.getTime() + ttlMs) } }),
  ]);
  return token;
}

/** The user behind a usable token, without using it up. */
export async function peekToken(token: string, purpose: TokenPurpose, now = new Date()): Promise<string | null> {
  const row = await db.emailToken.findUnique({ where: { tokenHash: hash(token) }, select: { userId: true, purpose: true, usedAt: true, expiresAt: true } });
  return row && row.purpose === purpose && !row.usedAt && row.expiresAt > now ? row.userId : null;
}

/** Uses the token up atomically; the user id, or null for a bad, expired, used or wrong-purpose token. */
export async function claimToken(token: string, purpose: TokenPurpose, now = new Date()): Promise<string | null> {
  const tokenHash = hash(token);
  const claimed = await db.emailToken.updateMany({ where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (claimed.count !== 1) return null;
  const row = await db.emailToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}

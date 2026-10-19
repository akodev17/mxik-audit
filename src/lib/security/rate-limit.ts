// Rate limits that survive restarts and span instances: every attempt is a row in auth_attempt.
// Keys are stored as keyed hashes, so the table holds no addresses or e-mails in clear.
import { db } from '../db.js';
import { keyedHash } from './secret.js';

export type Rule = { kind: string; limit: number; windowMs: number };
export type Verdict = { allowed: boolean; retryAfterMs: number; remaining: number };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export const RULES = {
  /** Password attempts for one e-mail; a successful sign-in clears them. */
  passwordEmail: { kind: 'password', limit: 5, windowMs: 15 * MINUTE },
  /** Sign-in attempts from one address, right or wrong. */
  signInIp: { kind: 'password_ip', limit: 30, windowMs: 15 * MINUTE },
  /** Codes tried in one pending two-factor sign-in; then the password is asked again. */
  twoFactorPending: { kind: 'two_factor', limit: 5, windowMs: 15 * MINUTE },
  /** Codes tried for one user, across pending sign-ins and settings. */
  twoFactorUser: { kind: 'two_factor_user', limit: 10, windowMs: 60 * MINUTE },
  /** Password re-entry by a signed-in user (change password, close account). */
  passwordConfirm: { kind: 'password_confirm', limit: 5, windowMs: 15 * MINUTE },
  resetEmail: { kind: 'reset', limit: 3, windowMs: 60 * MINUTE },
  resetIp: { kind: 'reset_ip', limit: 10, windowMs: 60 * MINUTE },
  resendEmail: { kind: 'resend', limit: 3, windowMs: 60 * MINUTE },
  resendIp: { kind: 'resend_ip', limit: 10, windowMs: 60 * MINUTE },
  signupIp: { kind: 'signup', limit: 8, windowMs: 60 * MINUTE },
} as const satisfies Record<string, Rule>;

export const attemptKey = (key: string): string => keyedHash('auth-attempt', key);

async function retryAfter(rule: Rule, key: string, now: Date): Promise<number> {
  const oldest = await db.authAttempt.findFirst({
    where: { kind: rule.kind, key, createdAt: { gt: new Date(now.getTime() - rule.windowMs) } },
    orderBy: { createdAt: 'asc' }, select: { createdAt: true },
  });
  return oldest ? Math.max(0, oldest.createdAt.getTime() + rule.windowMs - now.getTime()) : 0;
}

/**
 * Records one attempt and says whether it is within the limit. The row is written before
 * counting, so concurrent requests can never get more than `limit` attempts through; a
 * refused attempt removes its own row, so hammering does not grow the table.
 */
export async function hit(rule: Rule, rawKey: string, now = new Date()): Promise<Verdict> {
  const key = attemptKey(rawKey);
  const row = await db.authAttempt.create({ data: { kind: rule.kind, key, createdAt: now }, select: { id: true } });
  const n = await db.authAttempt.count({ where: { kind: rule.kind, key, createdAt: { gt: new Date(now.getTime() - rule.windowMs) } } });
  if (n <= rule.limit) return { allowed: true, retryAfterMs: 0, remaining: rule.limit - n };
  await db.authAttempt.delete({ where: { id: row.id } }).catch(() => undefined);
  return { allowed: false, retryAfterMs: await retryAfter(rule, key, now), remaining: 0 };
}

/** Forgets the attempts behind a key, e.g. after the right password. */
export async function clearAttempts(rule: Rule, rawKey: string): Promise<void> {
  await db.authAttempt.deleteMany({ where: { kind: rule.kind, key: attemptKey(rawKey) } });
}

/** Whole minutes to wait, at least one, for messages. */
export const minutesOf = (ms: number): number => Math.max(1, Math.ceil(ms / MINUTE));

/** Drops attempts older than a day; run by the daily job. */
export async function pruneAttempts(now = new Date()): Promise<number> {
  const done = await db.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY) } } });
  return done.count;
}

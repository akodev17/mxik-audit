// Two-factor sign-in: set up an authenticator, confirm it, recovery codes, check a login code.
import { createHash, randomBytes } from 'node:crypto';
import { db } from '@tasnivo/db';
import { keyedHash } from './secret.js';
import { endUserSessions } from './session-store.js';
import { matchStep, newSecret, openSecret, otpauthUri, sealSecret } from './totp.js';

const RECOVERY_COUNT = 8;
/** 10 random bytes = 80 bits per recovery code. */
const RECOVERY_BYTES = 10;
const ISSUER = 'Tasnivo';

const normalize = (code: string): string => code.replace(/[\s-]/g, '').toLowerCase();

/** Recovery codes are stored as an HMAC keyed by a secret derived from SESSION_SECRET. */
export const recoveryHash = (code: string): string => keyedHash('recovery', normalize(code));

// Codes issued before the HMAC (10 hex characters, plain SHA-256) keep working until regenerated.
const legacyHash = (code: string): string | null => {
  const clean = normalize(code);
  return /^[0-9a-f]{10}$/.test(clean) ? createHash('sha256').update(clean).digest('hex') : null;
};

/** xxxxx-xxxxx-xxxxx-xxxxx: 20 hex characters. */
export function newRecoveryCode(): string {
  const raw = randomBytes(RECOVERY_BYTES).toString('hex');
  return raw.match(/.{5}/g)?.join('-') ?? raw;
}

export type TwoFactorState = { enabled: boolean; recoveryLeft: number };

export async function twoFactorState(userId: string): Promise<TwoFactorState> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  const recoveryLeft = await db.recoveryCode.count({ where: { userId, usedAt: null } });
  return { enabled: Boolean(user?.totpEnabledAt), recoveryLeft: user?.totpEnabledAt ? recoveryLeft : 0 };
}

/** Stores a fresh, not yet active secret and returns what the authenticator app needs. */
export async function beginSetup(userId: string, email: string): Promise<{ secret: string; uri: string } | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } });
  if (!user || user.totpEnabledAt) return null;
  const secret = newSecret();
  await db.user.update({ where: { id: userId }, data: { totpSecret: sealSecret(secret), totpLastStep: null } });
  return { secret, uri: otpauthUri(secret, email, ISSUER) };
}

async function writeRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  await db.$transaction([
    db.recoveryCode.deleteMany({ where: { userId } }),
    db.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: recoveryHash(c) })) }),
  ]);
  return codes;
}

/**
 * Activates two-factor once the user proves the app shows the right code; returns the recovery codes
 * once. Every other session of the user ends (`keepSid` is this browser's): a session opened before,
 * perhaps by whoever made two-factor necessary, must not outlive it.
 */
export async function confirmSetup(user: { userId: string; orgId: string }, code: string, keepSid: string | null = null): Promise<string[] | null> {
  const row = await db.user.findUnique({ where: { id: user.userId }, select: { totpSecret: true, totpEnabledAt: true } });
  const secret = row?.totpSecret && !row.totpEnabledAt ? openSecret(row.totpSecret) : null;
  const step = secret ? matchStep(secret, code, null) : null;
  if (step === null) return null;
  await db.user.update({ where: { id: user.userId }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
  const ended = await endUserSessions(user.userId, keepSid);
  await db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'security.2fa_enabled', targetId: user.userId, payload: { sessionsEnded: ended } } });
  return writeRecoveryCodes(user.userId);
}

/** A login code (authenticator or unused recovery code) for a user who has two-factor on. */
export async function verifyLogin(userId: string, input: string): Promise<boolean> {
  const row = await db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true } });
  if (!row?.totpEnabledAt || !row.totpSecret) return false;
  const secret = openSecret(row.totpSecret);
  const step = secret ? matchStep(secret, input, row.totpLastStep) : null;
  if (step !== null) {
    // The step is only moved forward, so a replayed code finds nothing to update.
    const moved = await db.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return moved.count === 1;
  }
  const hashes = [recoveryHash(input), legacyHash(input)].filter((h): h is string => h !== null);
  const used = await db.recoveryCode.updateMany({ where: { userId, codeHash: { in: hashes }, usedAt: null }, data: { usedAt: new Date() } });
  return used.count >= 1;
}

export async function disable(user: { userId: string; orgId: string }, input: string): Promise<boolean> {
  if (!(await verifyLogin(user.userId, input))) return false;
  await db.$transaction([
    db.user.update({ where: { id: user.userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
    db.recoveryCode.deleteMany({ where: { userId: user.userId } }),
    db.auditEvent.create({ data: { orgId: user.orgId, actorId: user.userId, action: 'security.2fa_disabled', targetId: user.userId, payload: {} } }),
  ]);
  return true;
}

/** New recovery codes replace the old ones; needs a valid current code. */
export async function regenerateRecovery(userId: string, input: string): Promise<string[] | null> {
  return (await verifyLogin(userId, input)) ? writeRecoveryCodes(userId) : null;
}

// Caps wrong two-factor codes: five per pending sign-in (then the password is asked again)
// and ten per user per hour across sign-ins and settings.
import { clearAttempts, hit, RULES } from './rate-limit.js';
import { verifyLogin } from './two-factor.js';

export type CodeCheck = 'ok' | 'wrong' | 'locked';

export const pendingKey = (userId: string, startedAt: number): string => `${userId}:${startedAt}`;

/** A code for a pending sign-in. 'locked' means this pending sign-in is over. */
export async function checkPendingCode(userId: string, startedAt: number, input: string, now = new Date()): Promise<CodeCheck> {
  const key = pendingKey(userId, startedAt);
  const pending = await hit(RULES.twoFactorPending, key, now);
  if (!pending.allowed) return 'locked';
  const user = await hit(RULES.twoFactorUser, userId, now);
  if (!user.allowed) return 'locked';
  if (await verifyLogin(userId, input)) {
    await Promise.all([clearAttempts(RULES.twoFactorPending, key), clearAttempts(RULES.twoFactorUser, userId)]);
    return 'ok';
  }
  return pending.remaining === 0 || user.remaining === 0 ? 'locked' : 'wrong';
}

/** Counts a code typed by a signed-in user in Settings; false when the user is over the limit. */
export async function codeAttemptAllowed(userId: string): Promise<boolean> {
  return (await hit(RULES.twoFactorUser, userId)).allowed;
}

export async function codeAccepted(userId: string): Promise<void> {
  await clearAttempts(RULES.twoFactorUser, userId);
}

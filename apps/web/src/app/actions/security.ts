'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getI18n } from '@/lib/locale';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { formText } from '@/lib/form';
import { admin } from '@/lib/guard';
import { verifyPassword } from '@/lib/password';
import { requestDeletion, restoreAccount, setRetention } from '@/lib/security/account';
import { changePassword as changeUserPassword } from '@/lib/security/password-change';
import { MIN_PASSWORD } from '@/lib/security/password-check';
import { qrPath, type QrPath } from '@/lib/security/qr';
import { clearAttempts, hit, minutesOf, RULES } from '@/lib/security/rate-limit';
import { isReservedEmail } from '@/lib/security/reserved-email';
import { isLive, revokeOthers, revokeSession } from '@/lib/security/session-store';
import { completePending } from '@/lib/security/sign-in';
import { codeAccepted, codeAttemptAllowed } from '@/lib/security/two-factor-attempts';
import { beginSetup, confirmSetup, disable, regenerateRecovery } from '@/lib/security/two-factor';
import { currentUser, getSession, type CurrentUser } from '@/lib/session';
import { telegramConfig } from '@/lib/telegram/config';
import { telegramBinding, unbindTelegram } from '@/lib/telegram/identity';

const Code = z.string().trim().min(6).max(32);

export type TwoFactorLoginState = { error?: string };

/** Second step of sign-in: the authenticator code or a recovery code. Too many wrong codes end the pending sign-in. */
export async function submitTwoFactor(_prev: TwoFactorLoginState, form: FormData): Promise<TwoFactorLoginState> {
  const { ta } = await getI18n();
  const code = Code.safeParse(form.get('code'));
  if (!code.success) return { error: ta.security.codeWrong };
  const result = await completePending(code.data);
  if (result.ok) redirect(result.next);
  if (result.reason === 'locked') redirect('/sign-in?error=2fa_locked');
  if (result.reason === 'expired') redirect('/sign-in?error=2fa_expired');
  return { error: ta.security.codeWrong };
}

/** A signed-in, non-demo user; null otherwise. */
async function member(): Promise<CurrentUser | null> {
  const user = await currentUser();
  return user && !(await isDemoOrg(user.orgId)) ? user : null;
}

export async function startTwoFactor(): Promise<{ secret: string; uri: string; qr: QrPath } | null> {
  const user = await member();
  const setup = user ? await beginSetup(user.userId, user.email) : null;
  return setup ? { ...setup, qr: qrPath(setup.uri) } : null;
}

/** Runs a code check for the signed-in user under the per-user two-factor limit. */
async function withCode<T>(code: unknown, job: (user: CurrentUser, code: string) => Promise<T | null>): Promise<T | null> {
  const user = await member();
  const parsed = Code.safeParse(code);
  if (!user || !parsed.success || !(await codeAttemptAllowed(user.userId))) return null;
  const result = await job(user, parsed.data);
  if (result !== null) await codeAccepted(user.userId);
  revalidatePath('/settings');
  return result;
}

export async function finishTwoFactor(code: unknown): Promise<string[] | null> {
  return withCode(code, (user, c) => confirmSetup(user, c));
}

export async function turnOffTwoFactor(code: unknown): Promise<boolean> {
  return (await withCode(code, async (user, c) => ((await disable(user, c)) ? true : null))) === true;
}

export async function newRecoveryCodes(code: unknown): Promise<string[] | null> {
  return withCode(code, (user, c) => regenerateRecovery(user.userId, c));
}

export async function endSession(sid: unknown): Promise<boolean> {
  const user = await member();
  const id = z.string().min(1).safeParse(sid);
  if (!user || !id.success) return false;
  const ok = await revokeSession(user, id.data);
  revalidatePath('/settings');
  return ok;
}

export async function endOtherSessions(): Promise<number> {
  const user = await member();
  if (!user) return 0;
  const count = await revokeOthers(user, (await getSession()).sid ?? null);
  revalidatePath('/settings');
  return count;
}

export type PasswordState = { error?: string; done?: string };

/** Settings → Security: current and new password; every other session of the user ends. */
export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const { ta } = await getI18n();
  const user = await member();
  if (!user) return { error: ta.security.failed };
  const verdict = await hit(RULES.passwordConfirm, user.userId);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  const result = await changeUserPassword(user, formText(form, 'current'), formText(form, 'next'), (await getSession()).sid ?? null);
  if (!result.ok) return { error: result.error === 'wrong' ? ta.secX.password.wrong : ta.secX.password.short(MIN_PASSWORD) };
  await clearAttempts(RULES.passwordConfirm, user.userId);
  revalidatePath('/settings');
  return { done: ta.secX.password.done(result.sessionsEnded) };
}

export type SecurityExtras = {
  telegram: { available: boolean; bot: string | null; bound: boolean; canUnbind: boolean };
  passwordMin: number;
  /** False for an account opened with Telegram: it has no password the person knows. */
  passwordChangeable: boolean;
};

/** What the security panel needs beyond two-factor and sessions. */
export async function securityExtras(): Promise<SecurityExtras | null> {
  const user = await member();
  if (!user) return null;
  const tg = telegramConfig();
  const binding = await telegramBinding(user.userId);
  return {
    telegram: { available: tg.enabled && tg.username !== null, bot: tg.username, ...binding },
    passwordMin: MIN_PASSWORD,
    passwordChangeable: !isReservedEmail(user.email),
  };
}

/** Starts binding Telegram for sign-in: a one-time state the widget's callback must bring back (src/app/api/auth/telegram/bind). */
export async function startTelegramBind(): Promise<string | null> {
  const user = await member();
  if (!user || !telegramConfig().enabled) return null;
  const session = await getSession();
  session.tgBind = randomBytes(18).toString('base64url');
  session.tgBindAt = Date.now();
  await session.save();
  return session.tgBind;
}

export async function stopTelegramLogin(): Promise<boolean> {
  const user = await member();
  if (!user) return false;
  const ok = await unbindTelegram(user);
  revalidatePath('/settings');
  return ok;
}

export async function changeRetention(days: unknown): Promise<boolean> {
  const user = await admin();
  const parsed = z.union([z.number().int(), z.null()]).safeParse(days);
  if (!user || !parsed.success || await isDemoOrg(user.orgId)) return false;
  const ok = await setRetention(user, parsed.data);
  revalidatePath('/settings');
  return ok;
}

export type DeleteState = { error?: string };

/** Closes the account after the admin repeats the password; the browser is signed out. */
export async function closeAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const { ta } = await getI18n();
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: ta.security.deleteFailed };
  const verdict = await hit(RULES.passwordConfirm, user.userId);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  const row = await db.user.findUnique({ where: { id: user.userId }, select: { passwordHash: true } });
  const password = form.get('password');
  if (!row || typeof password !== 'string' || !(await verifyPassword(password, row.passwordHash))) return { error: ta.security.passwordWrong };
  await clearAttempts(RULES.passwordConfirm, user.userId);
  if (!(await requestDeletion(user))) return { error: ta.security.deleteFailed };
  (await getSession()).destroy();
  redirect('/sign-in?error=closed');
}

/** From the closed-account page: an admin of the closed org reopens it. */
export async function reopenAccount(): Promise<void> {
  const session = await getSession();
  if (!session.userId || !session.orgId || !session.sid || !(await isLive(session.sid, session.userId))) redirect('/sign-in');
  const user = await db.user.findFirst({ where: { id: session.userId, orgId: session.orgId, role: 'admin' }, select: { id: true } });
  if (user && await restoreAccount({ userId: user.id, orgId: session.orgId })) redirect('/dashboard');
  redirect('/account-deleted');
}

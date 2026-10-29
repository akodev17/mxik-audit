// Settings → Security and the account's lifecycle for a signed-in user: two-factor setup with
// its per-user code limit, the password change, Telegram sign-in binding, closing and reopening
// the account. Shared by the web app's server actions and the API; the caller has already checked
// who may call (a signed-in member of a real org, an admin for closing) and supplies the session
// cookie where one is read or written.
import { randomBytes } from 'node:crypto';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { verifyPassword } from '../password.js';
import type { SessionData } from '../session.js';
import { telegramConfig } from '../telegram/config.js';
import { telegramBinding } from '../telegram/identity.js';
import { purgeDate, requestDeletion, restoreAccount } from './account.js';
import type { ErrorState, Redirect } from './auth-forms.js';
import { TwoFactorCode } from './auth-forms.js';
import { changePassword } from './password-change.js';
import { MIN_PASSWORD } from './password-check.js';
import { qrPath, type QrPath } from './qr.js';
import { clearAttempts, hit, minutesOf, RULES } from './rate-limit.js';
import { isReservedEmail } from './reserved-email.js';
import { isLive } from './session-store.js';
import type { SignInSession } from './sign-in.js';
import { codeAccepted, codeAttemptAllowed } from './two-factor-attempts.js';
import { beginSetup, confirmSetup, disable, regenerateRecovery } from './two-factor.js';

type Member = { userId: string; orgId: string; email: string };

export async function startTwoFactor(user: Member): Promise<{ secret: string; uri: string; qr: QrPath } | null> {
  const setup = await beginSetup(user.userId, user.email);
  return setup ? { ...setup, qr: qrPath(setup.uri) } : null;
}

/** Runs a code check for the signed-in user under the per-user two-factor limit; null for a malformed code, the limit or a refusal. */
async function withCode<T>(user: Member, code: unknown, job: (code: string) => Promise<T | null>): Promise<T | null> {
  const parsed = TwoFactorCode.safeParse(code);
  if (!parsed.success || !(await codeAttemptAllowed(user.userId))) return null;
  const result = await job(parsed.data);
  if (result !== null) await codeAccepted(user.userId);
  return result;
}

/** Confirms the setup; the recovery codes once, or null. Every session but `keepSid` (this browser's) ends. */
export async function finishTwoFactor(user: Member, code: unknown, keepSid: string | null = null): Promise<string[] | null> {
  return withCode(user, code, (c) => confirmSetup(user, c, keepSid));
}

export async function turnOffTwoFactor(user: Member, code: unknown): Promise<boolean> {
  return (await withCode(user, code, async (c) => ((await disable(user, c)) ? true : null))) === true;
}

export async function newRecoveryCodes(user: Member, code: unknown): Promise<string[] | null> {
  return withCode(user, code, (c) => regenerateRecovery(user.userId, c));
}

export type PasswordState = { error?: string; done?: string };

/** Current and new password, under the password re-entry limit; every other session of the user ends. */
export async function changePasswordForm(
  user: Member, input: { current: string; next: string }, keepSid: string | null, locale: Locale,
): Promise<PasswordState> {
  const { ta } = i18nFor(locale);
  const verdict = await hit(RULES.passwordConfirm, user.userId);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  const result = await changePassword(user, input.current, input.next, keepSid);
  if (!result.ok) return { error: result.error === 'wrong' ? ta.secX.password.wrong : ta.secX.password.short(MIN_PASSWORD) };
  await clearAttempts(RULES.passwordConfirm, user.userId);
  return { done: ta.secX.password.done(result.sessionsEnded) };
}

export type SecurityExtras = {
  telegram: { available: boolean; bot: string | null; bound: boolean; canUnbind: boolean };
  passwordMin: number;
  /** False for an account opened with Telegram: it has no password the person knows. */
  passwordChangeable: boolean;
};

/** What the security panel needs beyond two-factor and sessions. */
export async function securityExtras(user: Member): Promise<SecurityExtras> {
  const tg = telegramConfig();
  const binding = await telegramBinding(user.userId);
  return {
    telegram: { available: tg.enabled && tg.username !== null, bot: tg.username, ...binding },
    passwordMin: MIN_PASSWORD,
    passwordChangeable: !isReservedEmail(user.email),
  };
}

/** Starts binding Telegram for sign-in: a one-time state in the session that the widget's callback must bring back. Null when Telegram is off. */
export async function startTelegramBind(session: SignInSession): Promise<string | null> {
  if (!telegramConfig().enabled) return null;
  const state = randomBytes(18).toString('base64url');
  session.tgBind = state;
  session.tgBindAt = Date.now();
  await session.save();
  return state;
}

/**
 * Closes the account after the admin repeats the password, under the password re-entry limit.
 * `{ redirect }` means it is closed: the caller ends the browser's session.
 */
export async function closeAccountForm(user: { userId: string; orgId: string }, password: unknown, locale: Locale): Promise<Redirect | ErrorState> {
  const { ta } = i18nFor(locale);
  const verdict = await hit(RULES.passwordConfirm, user.userId);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  const row = await db.user.findUnique({ where: { id: user.userId }, select: { passwordHash: true } });
  if (!row || typeof password !== 'string' || !(await verifyPassword(password, row.passwordHash))) return { error: ta.security.passwordWrong };
  await clearAttempts(RULES.passwordConfirm, user.userId);
  if (!(await requestDeletion(user))) return { error: ta.security.deleteFailed };
  return { redirect: '/sign-in?error=closed' };
}

/** The cookie's user while its session record is live, whatever the org's state (a closed org's admin may still reopen it). */
async function liveSessionUser({ userId, orgId, sid }: SessionData): Promise<{ userId: string; orgId: string } | null> {
  return userId && orgId && sid && (await isLive(sid, userId)) ? { userId, orgId } : null;
}

/** From the closed-account page: an admin of the closed org reopens it. Answers where the browser goes. */
export async function reopenAccount(session: SessionData): Promise<string> {
  const who = await liveSessionUser(session);
  if (!who) return '/sign-in';
  const user = await db.user.findFirst({ where: { id: who.userId, orgId: who.orgId, role: 'admin' }, select: { id: true } });
  if (user && await restoreAccount({ userId: user.id, orgId: who.orgId })) return '/dashboard';
  return '/account-deleted';
}

/** For the closed-account page: when the data is erased (null: the account is open) and whether this user may reopen it. Null without a live session. */
export async function closedAccountStatus(session: SessionData): Promise<{ purgeOn: Date | null; canReopen: boolean } | null> {
  const who = await liveSessionUser(session);
  if (!who) return null;
  const [date, user] = await Promise.all([purgeDate(who.orgId), db.user.findFirst({ where: { id: who.userId, orgId: who.orgId }, select: { role: true } })]);
  return { purgeOn: date, canReopen: user?.role === 'admin' };
}

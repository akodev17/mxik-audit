// The public sign-in forms (password, two-factor code, reset, confirmation code, e-mail link) as
// functions of their inputs, so the web app's server actions and the API answer the same way.
// The caller supplies the request facts (client address, user agent, language) and, where a form
// signs someone in, the session cookie as a SignInSession. A form that ended in redirect() in the
// web app answers `{ redirect }`; the caller navigates.
import { z } from 'zod';
import { db } from '@tasnivo/db';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { mailDeliverable } from '../mailer.js';
import { MIN_PASSWORD, passwordMatches } from './password-check.js';
import { requestReset, resetPassword } from './password-reset.js';
import { clearAttempts, hit, minutesOf, RULES } from './rate-limit.js';
import { safeNext } from './safe-next.js';
import { completePending, openSession, type SignInSession } from './sign-in.js';
import { confirmCode, confirmEmail, resendVerification, sendVerification, VERIFY_PATH } from './verification.js';

export type Redirect = { redirect: string };
/** What a form needs from the request: the client address (domain clientIp), the user agent and the interface language. */
export type RequestFacts = { ip: string; userAgent: string | null; locale: Locale };

export type SignInState = {
  error?: string;
  /** Kept for older clients; an unconfirmed account is now signed in and sent to the code step. */
  unverified?: boolean;
  /** A notice that is not an error (a new link was sent). */
  info?: string;
};
export type ForgotState = { error?: string; sent?: boolean };
export type ErrorState = { error?: string };

const Credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
/** Authenticator or recovery code. */
export const TwoFactorCode = z.string().trim().min(6).max(32);

const credentials = (email: string, password: string) => Credentials.safeParse({ email: email.trim().toLowerCase(), password });

/**
 * E-mail and password. Limited per address and per e-mail (counted before the check, so parallel
 * guesses cannot slip past; the right password clears the e-mail's count). `rememberLocale` is
 * called with the user's saved language before the session opens, for the caller's locale cookie.
 */
export async function signInForm(
  session: SignInSession,
  input: { email: string; password: string; next?: string | null },
  req: RequestFacts & { rememberLocale?: (locale: string) => unknown },
): Promise<Redirect | SignInState> {
  const { t, ta } = i18nFor(req.locale);
  const parsed = credentials(input.email, input.password);
  // Never distinguish "no such user" from "wrong password".
  if (!parsed.success) return { error: t.signInError };
  const { email, password } = parsed.data;

  const byIp = await hit(RULES.signInIp, req.ip);
  if (!byIp.allowed) return { error: ta.secX.tooMany(minutesOf(byIp.retryAfterMs)) };
  const byEmail = await hit(RULES.passwordEmail, email);
  if (!byEmail.allowed) return { error: ta.secX.passwordCooldown(minutesOf(byEmail.retryAfterMs)) };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await passwordMatches(user, password))) return { error: t.signInError };
  await clearAttempts(RULES.passwordEmail, email);

  if (user.locale) await req.rememberLocale?.(user.locale);
  // An unconfirmed address is signed in to the code step only: the API refuses everything else until then.
  const landing = user.emailVerifiedAt ? safeNext(input.next) ?? '/dashboard' : VERIFY_PATH;
  const next = await openSession(session, user, { via: 'password', landing }, req.userAgent);
  if (!next) return { error: t.signInError };
  return { redirect: next };
}

/** /sign-in/forgot: mails a reset link. The answer is the same whether or not the address has an account. */
export async function forgotPasswordForm(emailInput: string, req: Pick<RequestFacts, 'ip' | 'locale'>): Promise<ForgotState> {
  const { ta } = i18nFor(req.locale);
  if (!mailDeliverable()) return { error: ta.secX.forgot.noMail };
  const email = z.string().email().max(200).safeParse(emailInput.trim().toLowerCase());
  if (!email.success) return { error: ta.msg.account.emailBad };
  for (const [rule, key] of [[RULES.resetIp, req.ip], [RULES.resetEmail, email.data]] as const) {
    const verdict = await hit(rule, key);
    if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  }
  await requestReset(email.data, req.locale);
  return { sent: true };
}

/** /reset/[token]: sets the new password, ends every session and sends the browser to sign in. */
export async function resetPasswordForm(token: string, input: { password: string; repeat: string }, locale: Locale): Promise<Redirect | ErrorState> {
  const { ta } = i18nFor(locale);
  if (input.password !== input.repeat) return { error: ta.secX.reset.mismatch };
  const result = await resetPassword(token, input.password);
  if (!result.ok) return { error: result.error === 'short' ? ta.secX.password.short(MIN_PASSWORD) : ta.secX.reset.badHint };
  return { redirect: '/sign-in?notice=reset_done' };
}

/** From the sign-in page (after a dead link): a new confirmation code for an unconfirmed account. Same answer whether or not anything was sent. */
export async function resendConfirmationForm(input: { email: string; password: string }, req: Pick<RequestFacts, 'ip' | 'locale'>): Promise<SignInState> {
  const { ta } = i18nFor(req.locale);
  const parsed = credentials(input.email, input.password);
  if (!parsed.success) return { info: ta.secX.resendSent };
  for (const [rule, key] of [[RULES.resendIp, req.ip], [RULES.resendEmail, parsed.data.email]] as const) {
    const verdict = await hit(rule, key);
    if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  }
  await resendVerification(parsed.data.email, parsed.data.password, req.locale);
  return { info: ta.secX.resendSent };
}

/** Second step of sign-in: the authenticator code or a recovery code. Too many wrong codes end the pending sign-in. */
export async function twoFactorForm(session: SignInSession, code: unknown, req: Pick<RequestFacts, 'userAgent' | 'locale'>): Promise<Redirect | ErrorState> {
  const { ta } = i18nFor(req.locale);
  const parsed = TwoFactorCode.safeParse(code);
  if (!parsed.success) return { error: ta.security.codeWrong };
  const result = await completePending(session, parsed.data, req.userAgent);
  if (result.ok) return { redirect: result.next };
  if (result.reason === 'locked') return { redirect: '/sign-in?error=2fa_locked' };
  if (result.reason === 'expired') return { redirect: '/sign-in?error=2fa_expired' };
  return { error: ta.security.codeWrong };
}

/** The signed-in user the code step works for. */
type Unconfirmed = { userId: string; email: string };

const confirmed = async (userId: string): Promise<boolean> =>
  Boolean((await db.user.findUnique({ where: { id: userId }, select: { emailVerifiedAt: true } }))?.emailVerifiedAt);

/**
 * The code step (/sign-up/verify): the six-digit code from the mail. Limited per user across codes;
 * each code also allows only a few wrong entries. Answers where the browser goes once confirmed.
 */
export async function verifyCodeForm(user: Unconfirmed, code: string, req: Pick<RequestFacts, 'locale'>): Promise<Redirect | ErrorState> {
  const { ta } = i18nFor(req.locale);
  const v = ta.verifyX;
  if (await confirmed(user.userId)) return { redirect: '/dashboard' };
  const verdict = await hit(RULES.verifyCodeUser, user.userId);
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  const result = await confirmCode(user.userId, code);
  if (result === 'ok') {
    await clearAttempts(RULES.verifyCodeUser, user.userId);
    return { redirect: '/dashboard' };
  }
  return { error: result === 'wrong' ? v.wrong : result === 'locked' ? v.locked : v.expired };
}

/** "Send the code again" on the code step: limited per address and per mailbox. */
export async function resendCodeForm(user: Unconfirmed, req: Pick<RequestFacts, 'ip' | 'locale'>): Promise<Redirect | SignInState> {
  const { ta } = i18nFor(req.locale);
  if (await confirmed(user.userId)) return { redirect: '/dashboard' };
  for (const [rule, key] of [[RULES.resendIp, req.ip], [RULES.resendEmail, user.email]] as const) {
    const verdict = await hit(rule, key);
    if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  }
  if (!mailDeliverable() || !(await sendVerification(user.userId, user.email, req.locale))) return { error: ta.verifyX.resendFailed };
  return { info: ta.verifyX.resent };
}

/** The link in a confirmation e-mail sent before the codes: confirms the address and signs the user in. Answers where the browser goes. */
export async function verifyEmailLink(session: SignInSession, token: string, userAgent: string | null): Promise<string> {
  const user = await confirmEmail(token);
  // The notice on the sign-in page offers a new link.
  if (!user) return '/sign-in?error=verify';
  const next = await openSession(session, { id: user.userId, orgId: user.orgId, email: user.email }, { via: 'email', landing: '/dashboard' }, userAgent);
  return next ?? '/sign-in';
}

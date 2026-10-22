'use server';

import { getI18n } from '@/lib/locale';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOCALE_COOKIE } from '@/lib/locale';
import { z } from 'zod';
import { db } from '@tasnivo/db';
import { formText } from '@tasnivo/domain/form';
import { mailEnabled } from '@tasnivo/domain/mailer';
import { clientIp } from '@tasnivo/domain/security/client-ip';
import { MIN_PASSWORD, passwordMatches } from '@tasnivo/domain/security/password-check';
import { requestReset, resetPassword } from '@tasnivo/domain/security/password-reset';
import { clearAttempts, hit, minutesOf, RULES } from '@tasnivo/domain/security/rate-limit';
import { safeNext } from '@tasnivo/domain/security/safe-next';
import { openSession } from '@/lib/security/sign-in';
import { resendVerification } from '@tasnivo/domain/security/verification';

const Credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export type SignInState = {
  error?: string;
  /** The password was right but the address is not confirmed yet: offer to resend the link. */
  unverified?: boolean;
  /** A notice that is not an error (a new link was sent). */
  info?: string;
};

function credentials(form: FormData) {
  return Credentials.safeParse({ email: formText(form, 'email').trim().toLowerCase(), password: formText(form, 'password') });
}

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const { t, ta } = await getI18n();
  const parsed = credentials(form);
  // Never distinguish "no such user" from "wrong password".
  if (!parsed.success) return { error: t.signInError };
  const { email, password } = parsed.data;

  const byIp = await hit(RULES.signInIp, clientIp(await headers()));
  if (!byIp.allowed) return { error: ta.secX.tooMany(minutesOf(byIp.retryAfterMs)) };
  // Counted before the check, so parallel guesses cannot slip past the limit; the right password clears it.
  const byEmail = await hit(RULES.passwordEmail, email);
  if (!byEmail.allowed) return { error: ta.secX.passwordCooldown(minutesOf(byEmail.retryAfterMs)) };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await passwordMatches(user, password))) return { error: t.signInError };
  await clearAttempts(RULES.passwordEmail, email);

  // With SMTP configured, the address must be confirmed first.
  if (mailEnabled() && !user.emailVerifiedAt) return { error: ta.msg.verifyNeeded, unverified: true };

  if (user.locale) (await cookies()).set(LOCALE_COOKIE, user.locale, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' });
  const next = await openSession(user, { via: 'password', landing: safeNext(formText(form, 'next')) ?? '/dashboard' });
  if (!next) return { error: t.signInError };
  redirect(next);
}

export type ForgotState = { error?: string; sent?: boolean };

/** /sign-in/forgot: mails a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const { ta, locale } = await getI18n();
  if (!mailEnabled()) return { error: ta.secX.forgot.noMail };
  const email = z.string().email().max(200).safeParse(formText(form, 'email').trim().toLowerCase());
  if (!email.success) return { error: ta.msg.account.emailBad };
  for (const [rule, key] of [[RULES.resetIp, clientIp(await headers())], [RULES.resetEmail, email.data]] as const) {
    const verdict = await hit(rule, key);
    if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  }
  await requestReset(email.data, locale);
  return { sent: true };
}

export type ResetState = { error?: string };

/** /reset/[token]: sets the new password, ends every session and sends the browser to sign in. */
export async function resetPasswordWithToken(token: string, _prev: ResetState, form: FormData): Promise<ResetState> {
  const { ta } = await getI18n();
  const password = formText(form, 'password');
  if (password !== formText(form, 'repeat')) return { error: ta.secX.reset.mismatch };
  const result = await resetPassword(token, password);
  if (!result.ok) return { error: result.error === 'short' ? ta.secX.password.short(MIN_PASSWORD) : ta.secX.reset.badHint };
  redirect('/sign-in?notice=reset_done');
}

/** From the sign-in form: a new confirmation link for an unconfirmed account. Same answer whether or not anything was sent. */
export async function resendConfirmation(_prev: SignInState, form: FormData): Promise<SignInState> {
  const { ta, locale } = await getI18n();
  const parsed = credentials(form);
  if (!parsed.success) return { info: ta.secX.resendSent };
  for (const [rule, key] of [[RULES.resendIp, clientIp(await headers())], [RULES.resendEmail, parsed.data.email]] as const) {
    const verdict = await hit(rule, key);
    if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  }
  await resendVerification(parsed.data.email, parsed.data.password, locale);
  return { info: ta.secX.resendSent };
}

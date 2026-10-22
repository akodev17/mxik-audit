'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { formText } from '@tasnivo/domain/form';
import {
  forgotPasswordForm, resendConfirmationForm, resetPasswordForm, signInForm,
  type ForgotState, type SignInState,
} from '@tasnivo/domain/security/auth-forms';
import { getLocale, LOCALE_COOKIE } from '@/lib/locale';
import { requestFacts } from '@/lib/request-facts';
import { getSession } from '@/lib/session';

// The forms' rules live in @tasnivo/domain/security/auth-forms, shared with the API.
export type { ForgotState, SignInState };

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const result = await signInForm(
    await getSession(),
    { email: formText(form, 'email'), password: formText(form, 'password'), next: formText(form, 'next') },
    { ...(await requestFacts()), rememberLocale: async (locale) => (await cookies()).set(LOCALE_COOKIE, locale, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' }) },
  );
  if ('redirect' in result) redirect(result.redirect);
  return result;
}

/** /sign-in/forgot: mails a reset link. The answer is the same whether or not the address has an account. */
export async function requestPasswordReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  return forgotPasswordForm(formText(form, 'email'), await requestFacts());
}

export type ResetState = { error?: string };

/** /reset/[token]: sets the new password, ends every session and sends the browser to sign in. */
export async function resetPasswordWithToken(token: string, _prev: ResetState, form: FormData): Promise<ResetState> {
  const result = await resetPasswordForm(token, { password: formText(form, 'password'), repeat: formText(form, 'repeat') }, await getLocale());
  if ('redirect' in result) redirect(result.redirect);
  return result;
}

/** From the sign-in form: a new confirmation link for an unconfirmed account. Same answer whether or not anything was sent. */
export async function resendConfirmation(_prev: SignInState, form: FormData): Promise<SignInState> {
  return resendConfirmationForm({ email: formText(form, 'email'), password: formText(form, 'password') }, await requestFacts());
}

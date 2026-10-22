'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getI18n } from '@/lib/locale';
import { isDemoOrg } from '@/lib/demo';
import { formText } from '@tasnivo/domain/form';
import { admin } from '@/lib/guard';
import { setRetention } from '@tasnivo/domain/security/account';
import {
  changePasswordForm, closeAccountForm, finishTwoFactor as finishSetup, newRecoveryCodes as renewRecovery,
  reopenAccount as reopenTarget, securityExtras as extrasOf, startTelegramBind as startBind, startTwoFactor as beginTwoFactor,
  turnOffTwoFactor as disableTwoFactor, type PasswordState, type SecurityExtras,
} from '@tasnivo/domain/security/account-security';
import { twoFactorForm, type ErrorState } from '@tasnivo/domain/security/auth-forms';
import type { QrPath } from '@tasnivo/domain/security/qr';
import { revokeOthers, revokeSession } from '@tasnivo/domain/security/session-store';
import { requestFacts } from '@/lib/request-facts';
import { currentUser, getSession, type CurrentUser } from '@/lib/session';
import { unbindTelegram } from '@tasnivo/domain/telegram/identity';

// The rules live in @tasnivo/domain/security/account-security and auth-forms, shared with the API.
export type { PasswordState, SecurityExtras };
export type TwoFactorLoginState = ErrorState;
export type DeleteState = ErrorState;

/** Second step of sign-in: the authenticator code or a recovery code. Too many wrong codes end the pending sign-in. */
export async function submitTwoFactor(_prev: TwoFactorLoginState, form: FormData): Promise<TwoFactorLoginState> {
  const result = await twoFactorForm(await getSession(), form.get('code'), await requestFacts());
  if ('redirect' in result) redirect(result.redirect);
  return result;
}

/** A signed-in, non-demo user; null otherwise. */
async function member(): Promise<CurrentUser | null> {
  const user = await currentUser();
  return user && !(await isDemoOrg(user.orgId)) ? user : null;
}

export async function startTwoFactor(): Promise<{ secret: string; uri: string; qr: QrPath } | null> {
  const user = await member();
  return user ? beginTwoFactor(user) : null;
}

/** Runs a code check for a signed-in member; the per-user limit is applied by the domain. */
async function withMember<T>(fallback: T, job: (user: CurrentUser) => Promise<T>): Promise<T> {
  const user = await member();
  if (!user) return fallback;
  const result = await job(user);
  revalidatePath('/settings');
  return result;
}

export async function finishTwoFactor(code: unknown): Promise<string[] | null> {
  return withMember(null, (user) => finishSetup(user, code));
}

export async function turnOffTwoFactor(code: unknown): Promise<boolean> {
  return withMember(false, (user) => disableTwoFactor(user, code));
}

export async function newRecoveryCodes(code: unknown): Promise<string[] | null> {
  return withMember(null, (user) => renewRecovery(user, code));
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

/** Settings → Security: current and new password; every other session of the user ends. */
export async function changePassword(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const { ta, locale } = await getI18n();
  const user = await member();
  if (!user) return { error: ta.security.failed };
  const result = await changePasswordForm(user, { current: formText(form, 'current'), next: formText(form, 'next') }, (await getSession()).sid ?? null, locale);
  if (result.done) revalidatePath('/settings');
  return result;
}

/** What the security panel needs beyond two-factor and sessions. */
export async function securityExtras(): Promise<SecurityExtras | null> {
  const user = await member();
  return user ? extrasOf(user) : null;
}

/** Starts binding Telegram for sign-in: a one-time state the widget's callback must bring back (src/app/api/auth/telegram/bind). */
export async function startTelegramBind(): Promise<string | null> {
  const user = await member();
  return user ? startBind(await getSession()) : null;
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

/** Closes the account after the admin repeats the password; the browser is signed out. */
export async function closeAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const { ta, locale } = await getI18n();
  const user = await admin();
  if (!user || await isDemoOrg(user.orgId)) return { error: ta.security.deleteFailed };
  const result = await closeAccountForm(user, form.get('password'), locale);
  if (!('redirect' in result)) return result;
  (await getSession()).destroy();
  redirect(result.redirect);
}

/** From the closed-account page: an admin of the closed org reopens it. */
export async function reopenAccount(): Promise<void> {
  redirect(await reopenTarget(await getSession()));
}

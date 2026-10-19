'use server';

import { getI18n } from '@/lib/locale';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOCALE_COOKIE } from '@/lib/locale';
import { z } from 'zod';
import { db } from '@/lib/db';
import { mailEnabled } from '@/lib/mailer';
import { verifyPassword } from '@/lib/password';
import { openSession } from '@/lib/security/sign-in';

const Credentials = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export type SignInState = { error?: string };

/** FormData values can be Files; anything not a string is not a credential. */
function field(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const { t, ta } = await getI18n();
  const parsed = Credentials.safeParse({
    email: field(form, 'email').trim().toLowerCase(),
    password: field(form, 'password'),
  });
  // Never distinguish "no such user" from "wrong password".
  if (!parsed.success) return { error: t.signInError };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: t.signInError };
  }

  // With SMTP configured, a self-serve account must confirm its address first.
  if (mailEnabled() && !user.emailVerifiedAt) return { error: ta.msg.verifyNeeded };

  if (user.locale) (await cookies()).set(LOCALE_COOKIE, user.locale, { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' });
  const next = await openSession(user, { via: 'password', landing: '/dashboard' });
  if (!next) return { error: t.signInError };
  redirect(next);
}

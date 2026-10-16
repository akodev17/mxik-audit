'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/lib/db';
import { mailEnabled } from '@/lib/mailer';
import { verifyPassword } from '@/lib/password';
import { getSession } from '@/lib/session';
import { t } from '@/lib/i18n';

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
  if (mailEnabled() && !user.emailVerifiedAt) return { error: 'Elektron pochtani tasdiqlang: xatdagi havolani oching.' };

  const session = await getSession();
  session.userId = user.id;
  session.orgId = user.orgId;
  session.email = user.email;
  // Nothing from an earlier session (a demo, another org's client) carries over.
  session.demo = false;
  session.clientId = undefined;
  await session.save();

  await db.auditEvent.create({
    data: { orgId: user.orgId, actorId: user.id, action: 'user.signed_in', payload: {} },
  });

  redirect('/catalogs');
}

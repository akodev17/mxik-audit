'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { formText } from '@/lib/form';
import { getI18n } from '@/lib/locale';
import { clientKey, createRateLimiter } from '@/lib/lead-guard';
import { getSession } from '@/lib/session';
import { createAccount } from '@/lib/signup';

export type SignUpState = { error?: string; checkEmail?: boolean };

// One address can open only a few accounts an hour.
const limiter = createRateLimiter({ limit: 8, windowMs: 60 * 60 * 1000 });

/** Public signup: opens a 14-day trial org. With SMTP configured the address must be confirmed first. */
export async function signUp(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const { ta, locale } = await getI18n();
  if (!limiter.hit(clientKey(await headers())).allowed) return { error: ta.msg.tooManyAttempts };
  const result = await createAccount({ email: formText(form, 'email'), password: formText(form, 'password'), firmName: formText(form, 'firm'), locale });
  if (!result.ok) return { error: ta.msg.account[result.error] };
  if (result.account.needsVerification) return { checkEmail: true };

  const session = await getSession();
  session.userId = result.account.userId;
  session.orgId = result.account.orgId;
  session.email = result.account.email;
  session.demo = false;
  session.clientId = undefined;
  await session.save();
  redirect('/catalogs');
}

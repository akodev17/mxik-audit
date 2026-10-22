'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { formText } from '@/lib/form';
import { getI18n } from '@/lib/locale';
import { clientIp } from '@/lib/security/client-ip';
import { hit, minutesOf, RULES } from '@/lib/security/rate-limit';
import { openSession } from '@/lib/security/sign-in';
import { createAccount } from '@/lib/signup';

export type SignUpState = { error?: string; checkEmail?: boolean };

/**
 * Public signup: opens a 14-day trial org. With SMTP configured the address must be confirmed
 * first, and an address that is already registered gets the same "check your e-mail" answer.
 */
export async function signUp(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const { ta, locale } = await getI18n();
  const verdict = await hit(RULES.signupIp, clientIp(await headers()));
  if (!verdict.allowed) return { error: ta.secX.tooMany(minutesOf(verdict.retryAfterMs)) };
  const result = await createAccount({ email: formText(form, 'email'), password: formText(form, 'password'), firmName: formText(form, 'firm'), locale });
  if (!result.ok) return 'mailed' in result ? { checkEmail: true } : { error: ta.msg.account[result.error] };
  if (result.account.needsVerification) return { checkEmail: true };

  const next = await openSession({ id: result.account.userId, orgId: result.account.orgId, email: result.account.email }, { via: 'signup', landing: '/dashboard' });
  redirect(next ?? '/sign-in');
}

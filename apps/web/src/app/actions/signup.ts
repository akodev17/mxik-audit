'use server';

import { redirect } from 'next/navigation';
import { formText } from '@tasnivo/domain/form';
import { signUpForm } from '@tasnivo/domain/signup';
import { requestFacts } from '@/lib/request-facts';
import { getSession } from '@/lib/session';

export type SignUpState = { error?: string; checkEmail?: boolean };

/**
 * Public signup: opens a 14-day trial org. With SMTP configured the address must be confirmed
 * first, and an address that is already registered gets the same "check your e-mail" answer.
 * The rules are @tasnivo/domain/signup signUpForm, shared with the API.
 */
export async function signUp(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const result = await signUpForm(
    await getSession(),
    { email: formText(form, 'email'), password: formText(form, 'password'), firm: formText(form, 'firm') },
    await requestFacts(),
  );
  if ('redirect' in result) redirect(result.redirect);
  return result;
}

'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { signUp, type SignUpState } from '@/app/actions/signup';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function SignUpForm() {
  const { t, ta } = useI18n();
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUp, {});
  if (state.checkEmail) {
    return <p role="status" className="rounded-ctl border border-line bg-base p-6 text-sm shadow-pop">{ta.signup.checkEmail}</p>;
  }
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.signup.title}</h1>
      <Field label={ta.signup.firm}><Input name="firm" maxLength={120} autoComplete="organization" /></Field>
      <Field label={t.email}><Input name="email" type="email" required autoComplete="username" /></Field>
      <Field label={t.password} hint={ta.team.passwordHint}><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.signup.create}</Button>
      <p className="text-xs text-muted">{ta.signup.trialNote}</p>
    </form>
  );
}

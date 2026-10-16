'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { signIn, type SignInState } from '@/app/actions/auth';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function SignInForm({ notice }: { notice: string | null }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const error = state.error ?? notice;
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{t.signIn}</h1>
      <Field label={t.email}>
        <Input id="email" name="email" type="email" required autoComplete="username" autoFocus />
      </Field>
      <Field label={t.password}>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </Field>
      {error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? t.loading : t.signInAction}
      </Button>
    </form>
  );
}

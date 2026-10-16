'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { signIn, type SignInState } from '@/app/actions/auth';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export default function SignInPage() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <Link href="/" className="text-xl font-bold tracking-tight">{t.appName}</Link>
      <p className="mb-6 mt-1 text-sm text-muted">{t.tagline}</p>

      <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
        <h1 className="text-lg">{t.signIn}</h1>
        <Field label={t.email}>
          <Input id="email" name="email" type="email" required autoComplete="username" autoFocus />
        </Field>
        <Field label={t.password}>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </Field>
        {state.error ? (
          <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending} className="w-full">
          {pending ? t.loading : t.signInAction}
        </Button>
      </form>
    </main>
  );
}

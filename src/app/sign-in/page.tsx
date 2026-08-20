'use client';

import { useActionState } from 'react';
import { signIn, type SignInState } from '@/app/actions/auth';
import { t } from '@/lib/i18n';

export default function SignInPage() {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl">{t.appName}</h1>
      <p className="mt-1 mb-8 text-sm text-ink-soft">{t.tagline}</p>

      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm text-ink-soft">{t.email}</label>
          <input
            id="email" name="email" type="email" required autoComplete="username" autoFocus
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 focus:border-ink focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-ink-soft">{t.password}</label>
          <input
            id="password" name="password" type="password" required autoComplete="current-password"
            className="mt-1 w-full border border-rule bg-paper px-3 py-2 focus:border-ink focus:outline-none"
          />
        </div>
        {state.error ? (
          <p role="alert" className="border-l-2 border-risk bg-risk-tint px-3 py-2 text-sm text-risk">
            {state.error}
          </p>
        ) : null}
        <button
          type="submit" disabled={pending}
          className="w-full bg-ink px-4 py-2 text-paper disabled:opacity-50"
        >
          {pending ? t.loading : t.signInAction}
        </button>
      </form>
    </main>
  );
}

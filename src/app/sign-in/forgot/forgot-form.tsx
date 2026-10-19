'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { requestPasswordReset, type ForgotState } from '@/app/actions/auth';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function ForgotForm() {
  const { t, ta } = useI18n();
  const [state, action, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {});
  if (state.sent) {
    return <p role="status" className="rounded-ctl border border-line bg-base p-6 text-sm shadow-pop">{ta.secX.forgot.sent}</p>;
  }
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.secX.forgot.title}</h1>
      <p className="text-sm text-muted">{ta.secX.forgot.intro}</p>
      <Field label={t.email}>
        <Input name="email" type="email" required autoComplete="username" autoFocus />
      </Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.secX.forgot.submit}</Button>
    </form>
  );
}

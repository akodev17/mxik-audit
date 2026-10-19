'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { resetPasswordWithToken, type ResetState } from '@/app/actions/auth';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function ResetForm({ token, min }: { token: string; min: number }) {
  const { t, ta } = useI18n();
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPasswordWithToken.bind(null, token), {});
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.secX.reset.title}</h1>
      <Field label={ta.secX.password.next} hint={ta.secX.password.rule(min)}>
        <Input name="password" type="password" required minLength={min} maxLength={200} autoComplete="new-password" autoFocus />
      </Field>
      <Field label={ta.secX.reset.repeat}>
        <Input name="repeat" type="password" required minLength={min} maxLength={200} autoComplete="new-password" />
      </Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.secX.reset.submit}</Button>
    </form>
  );
}

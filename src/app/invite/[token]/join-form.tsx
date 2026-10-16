'use client';

import { useActionState } from 'react';
import { joinWithInvite, type JoinState } from '@/app/actions/team';
import { t } from '@/lib/i18n';
import { ta } from '@/lib/i18n-app';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function JoinForm({ token, email }: { token: string; email: string | null }) {
  const [state, action, pending] = useActionState<JoinState, FormData>(joinWithInvite.bind(null, token), {});
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <Field label={t.email}>
        <Input name="email" type="email" required defaultValue={email ?? ''} readOnly={email !== null} autoComplete="username" />
      </Field>
      <Field label={t.password} hint={ta.team.passwordHint}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.team.join}</Button>
    </form>
  );
}

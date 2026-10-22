'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields, useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function JoinForm({ token, email }: { token: string; email: string | null }) {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [error, setError] = useState<string | null>(null);
  const join = useMutation({
    mutationFn: (body: { email: string; password: string }) => api.team.join({ token, ...body }),
    onSuccess: (answer) => { if (!follow(answer)) setError('error' in answer ? answer.error ?? null : null); },
    onError: () => setError(t.errorGeneric),
  });
  const pending = join.isPending || leaving;
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const fields = formFields(form);
    join.mutate({ email: fields['email'] ?? '', password: fields['password'] ?? '' }, { onSettled: () => form.reset() });
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <Field label={t.email}>
        <Input name="email" type="email" required defaultValue={email ?? ''} readOnly={email !== null} autoComplete="username" />
      </Field>
      <Field label={t.password} hint={ta.team.passwordHint}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      {error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.team.join}</Button>
    </form>
  );
}

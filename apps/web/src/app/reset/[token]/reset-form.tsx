'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields, useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function ResetForm({ token, min }: { token: string; min: number }) {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: (body: { password: string; repeat: string }) => api.auth.resetPassword({ token, ...body }),
    onSuccess: (answer) => { if (!follow(answer)) setError('error' in answer ? answer.error ?? null : null); },
    onError: () => setError(t.errorGeneric),
  });
  const pending = reset.isPending || leaving;
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    const fields = formFields(form);
    reset.mutate({ password: fields['password'] ?? '', repeat: fields['repeat'] ?? '' }, { onSettled: () => form.reset() });
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.secX.reset.title}</h1>
      <Field label={ta.secX.password.next} hint={ta.secX.password.rule(min)}>
        <Input name="password" type="password" required minLength={min} maxLength={200} autoComplete="new-password" autoFocus />
      </Field>
      <Field label={ta.secX.reset.repeat}>
        <Input name="repeat" type="password" required minLength={min} maxLength={200} autoComplete="new-password" />
      </Field>
      {error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.secX.reset.submit}</Button>
    </form>
  );
}

'use client';

import { useMutation } from '@tanstack/react-query';
import { type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function ForgotForm() {
  const { t, ta } = useI18n();
  const request = useMutation({ mutationFn: (email: string) => api.auth.forgotPassword({ email }) });
  const state = request.data ?? (request.isError ? { error: t.errorGeneric } : {});
  if (state.sent) {
    return <p role="status" className="rounded-ctl border border-line bg-base p-6 text-sm shadow-pop">{ta.secX.forgot.sent}</p>;
  }
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (request.isPending) return;
    const form = e.currentTarget;
    request.mutate(formFields(form)['email'] ?? '', { onSettled: () => form.reset() });
  };
  return (
    <form onSubmit={submit} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.secX.forgot.title}</h1>
      <p className="text-sm text-muted">{ta.secX.forgot.intro}</p>
      <Field label={t.email}>
        <Input name="email" type="email" required autoComplete="username" autoFocus />
      </Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={request.isPending} className="w-full">{request.isPending ? t.loading : ta.secX.forgot.submit}</Button>
    </form>
  );
}

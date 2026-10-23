'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields, useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function TwoFactorForm() {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: (code: string) => api.auth.twoFactorSubmit({ code }),
    onSuccess: (answer) => { if (!follow(answer)) setError('error' in answer ? answer.error ?? null : null); },
    onError: () => setError(t.errorGeneric),
  });
  const pending = submit.isPending || leaving;
  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    submit.mutate(formFields(form)['code'] ?? '', { onSettled: () => form.reset() });
  };
  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.security.twoFactorTitle}</h1>
      <p className="text-sm text-muted">{ta.security.twoFactorText}</p>
      <Field label={ta.security.codeLabel}>
        <Input id="code" name="code" required autoComplete="one-time-code" inputMode="text" autoFocus />
      </Field>
      {error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? t.loading : ta.security.verify}
      </Button>
    </form>
  );
}

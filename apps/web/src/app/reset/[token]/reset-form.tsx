'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields, useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconLock } from '@/ui/icons';
import { Field } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { PasswordMeter } from '../../sign-in/password-meter';

export function ResetForm({ token, min }: { token: string; min: number }) {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [error, setError] = useState<string | null>(null);
  // Mirrored only to drive the strength hint; the form posts what the field holds.
  const [password, setPassword] = useState('');
  const meterId = useId();
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
    reset.mutate({ password: fields['password'] ?? '', repeat: fields['repeat'] ?? '' }, { onSettled: () => { form.reset(); setPassword(''); } });
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <Field label={ta.secX.password.next} hint={ta.secX.password.rule(min)}>
          <PasswordInput
            name="password" required minLength={min} maxLength={200} autoComplete="new-password" autoFocus size="lg"
            leadingIcon={<IconLock size={16} />} className={AUTH_FIELD} aria-describedby={meterId}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <PasswordMeter id={meterId} password={password} min={min} />
      </div>
      <Field label={ta.secX.reset.repeat}>
        <PasswordInput name="repeat" required minLength={min} maxLength={200} autoComplete="new-password" size="lg" leadingIcon={<IconLock size={16} />} className={AUTH_FIELD} />
      </Field>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">{ta.secX.reset.submit}</Button>
    </form>
  );
}

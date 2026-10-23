'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields, useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconLock, IconMail } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { MIN_PASSWORD_LENGTH } from '../../sign-in/credentials-check';
import { PasswordMeter } from '../../sign-in/password-meter';

export function JoinForm({ token, email }: { token: string; email: string | null }) {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const meterId = useId();
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
    join.mutate({ email: fields['email'] ?? '', password: fields['password'] ?? '' }, { onSettled: () => { form.reset(); setPassword(''); } });
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label={t.email}>
        <Input name="email" type="email" required defaultValue={email ?? ''} readOnly={email !== null} autoComplete="username" inputMode="email" size="lg" leadingIcon={<IconMail size={16} />} className={AUTH_FIELD} />
      </Field>
      <div>
        <Field label={t.password} hint={ta.team.passwordHint}>
          <PasswordInput
            name="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" size="lg" leadingIcon={<IconLock size={16} />} className={AUTH_FIELD}
            aria-describedby={meterId} onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <PasswordMeter id={meterId} password={password} min={MIN_PASSWORD_LENGTH} />
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">{ta.team.join}</Button>
    </form>
  );
}

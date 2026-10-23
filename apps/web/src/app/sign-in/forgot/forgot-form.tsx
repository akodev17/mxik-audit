'use client';

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { formFields } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD, AuthResult, AuthTitle } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconMail } from '@/ui/icons';
import { Field, Input } from '@/ui/input';

export function ForgotForm() {
  const { t, ta } = useI18n();
  const x = ta.authX.forgot;
  const request = useMutation({ mutationFn: (email: string) => api.auth.forgotPassword({ email }) });
  // The address the link went to, for the confirmation (the form itself is cleared after sending).
  const [sentTo, setSentTo] = useState('');
  const state = request.data ?? (request.isError ? { error: t.errorGeneric } : {});
  if (state.sent) {
    return (
      <AuthResult
        icon={<IconMail size={24} />} title={x.sentTitle}
        action={<Button variant="secondary" size="lg" className="w-full" onClick={() => request.reset()}>{x.again}</Button>}
      >
        <p>{sentTo ? x.sentTo(sentTo) : ta.secX.forgot.sent}</p>
        <p>{x.spam}</p>
      </AuthResult>
    );
  }
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (request.isPending) return;
    const form = e.currentTarget;
    const email = formFields(form)['email'] ?? '';
    setSentTo(email.trim());
    request.mutate(email, { onSettled: () => form.reset() });
  };
  return (
    <>
      <AuthTitle title={ta.secX.forgot.title} lead={ta.secX.forgot.intro} />
      <form onSubmit={submit} className="space-y-5">
        <Field label={t.email}>
          <Input name="email" type="email" required autoComplete="username" autoFocus size="lg" inputMode="email" leadingIcon={<IconMail size={16} />} className={AUTH_FIELD} />
        </Field>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <Button type="submit" variant="primary" size="lg" loading={request.isPending} className="w-full">{ta.secX.forgot.submit}</Button>
      </form>
    </>
  );
}

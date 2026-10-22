'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { checkCredentials, hasIssues, type CredentialIssues } from './credentials-check';

type SignInState = Exclude<OutputOf<typeof endpoints.auth.signIn>, { redirect: string }>;

type Props = {
  notice: string | null;
  /** A positive notice (password was reset). */
  info?: string | null;
  /** Same-site path to land on after signing in. */
  next?: string | null;
  /** Show "send the confirmation link again" before any attempt (the link in the e-mail had expired). */
  offerResend?: boolean;
};

export function SignInForm({ notice, info = null, next = null, offerResend = false }: Props) {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [state, setState] = useState<SignInState>({});
  const [resent, setResent] = useState<SignInState>({});
  // Controlled, so a failed attempt keeps the address (the password is cleared after every attempt).
  const [email, setEmail] = useState('');
  const [issues, setIssues] = useState<CredentialIssues>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const failed = (): SignInState => ({ error: t.errorGeneric });
  const clearPassword = (): void => { if (passwordRef.current) passwordRef.current.value = ''; };

  const signIn = useMutation({
    mutationFn: (body: { email: string; password: string; next?: string }) => api.auth.signIn(body),
    onSuccess: (answer) => { if (!follow(answer)) { clearPassword(); setState(answer as SignInState); } },
    onError: () => { clearPassword(); setState(failed()); },
  });
  const resend = useMutation({
    mutationFn: (body: { email: string; password: string }) => api.auth.resendConfirmation(body),
    onSuccess: (answer) => { clearPassword(); setResent(answer); },
    onError: () => { clearPassword(); setResent(failed()); },
  });
  const pending = signIn.isPending || leaving;
  const resending = resend.isPending;
  const error = resent.error ?? state.error ?? notice;
  const positive = resent.info ?? info;
  const canResend = offerResend || state.unverified === true;

  // After a refused attempt the password field is empty again: put the cursor there.
  useEffect(() => {
    if (state.error && !state.unverified) passwordRef.current?.focus();
  }, [state]);

  /** The fields as typed, or null (and the cursor on the first bad one) when a check fails. */
  const checked = (): { email: string; password: string } | null => {
    const password = passwordRef.current?.value ?? '';
    const found = checkCredentials(email, password, null);
    setIssues(found);
    if (!hasIssues(found)) return { email, password };
    (found.email ? emailRef : passwordRef).current?.focus();
    return null;
  };
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending || resending) return;
    const fields = checked();
    if (fields) signIn.mutate(next ? { ...fields, next } : fields);
  };
  const sendAgain = (): void => {
    if (pending || resending) return;
    const fields = checked();
    if (fields) resend.mutate(fields);
  };
  const emailError = issues.email === 'required' ? ta.secX.required.email : issues.email === 'bad' ? ta.msg.account.emailBad : undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{t.signIn}</h1>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label={t.email} error={emailError}>
        <Input
          ref={emailRef} id="email" name="email" type="email" required autoComplete="username" autoFocus
          value={email} onChange={(e) => { setEmail(e.target.value); setIssues((cur) => ({ ...cur, email: undefined })); }} invalid={emailError !== undefined}
        />
      </Field>
      <Field label={t.password} error={issues.password ? ta.secX.required.password : undefined}>
        <Input ref={passwordRef} id="password" name="password" type="password" required autoComplete="current-password" invalid={issues.password !== undefined} />
      </Field>
      {error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger-ink">{error}</p> : null}
      {positive ? <p role="status" className="rounded-ctl bg-good-tint px-3 py-2 text-sm">{positive}</p> : null}
      <Button type="submit" variant="primary" disabled={pending || resending} className="w-full">
        {pending ? t.loading : t.signInAction}
      </Button>
      {canResend ? (
        <Button type="button" variant="secondary" onClick={sendAgain} disabled={pending || resending} className="w-full whitespace-normal">
          {resending ? t.loading : ta.secX.resend}
        </Button>
      ) : null}
    </form>
  );
}

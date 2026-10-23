'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconClock, IconLock, IconMail } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { checkCredentials, hasIssues, type CredentialIssues } from './credentials-check';
import { rateLimitOf } from './rate-limit';

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
  const a = ta.authX.signIn;
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
  const throttled = rateLimitOf(error, ta.secX);
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
    <form onSubmit={submit} noValidate className="space-y-5">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {positive ? <Alert tone="good">{positive}</Alert> : null}
      <Field label={t.email} error={emailError}>
        <Input
          ref={emailRef} id="email" name="email" type="email" required autoComplete="username" autoFocus size="lg"
          leadingIcon={<IconMail size={16} />} className={AUTH_FIELD} inputMode="email"
          value={email} onChange={(e) => { setEmail(e.target.value); setIssues((cur) => ({ ...cur, email: undefined })); }} invalid={emailError !== undefined}
        />
      </Field>
      <Field
        label={t.password}
        error={issues.password ? ta.secX.required.password : undefined}
        labelAside={<Link href="/sign-in/forgot" className="rounded-sm font-medium text-brand-ink hover:underline">{ta.secX.forgotLink}</Link>}
      >
        <PasswordInput
          ref={passwordRef} id="password" name="password" required autoComplete="current-password" size="lg"
          leadingIcon={<IconLock size={16} />} className={AUTH_FIELD} invalid={issues.password !== undefined}
        />
      </Field>
      {throttled ? (
        <Alert
          tone="warn" title={a.rateLimited} icon={<IconClock size={16} />}
          action={throttled.kind === 'account' ? <Link href="/sign-in/forgot" className="rounded-sm font-semibold underline">{a.resetInstead}</Link> : undefined}
        >
          {error}
        </Alert>
      ) : error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={resending} className="w-full">
        {t.signInAction}
      </Button>
      {canResend ? (
        <Button type="button" variant="secondary" size="lg" onClick={sendAgain} loading={resending} disabled={pending} className="h-auto min-h-control-lg w-full whitespace-normal py-2">
          {ta.secX.resend}
        </Button>
      ) : null}
    </form>
  );
}

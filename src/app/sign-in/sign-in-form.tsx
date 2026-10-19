'use client';

import { useActionState, useEffect, useRef, useState, type FormEvent } from 'react';
import { resendConfirmation, signIn, type SignInState } from '@/app/actions/auth';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { checkCredentials, hasIssues, type CredentialIssues } from './credentials-check';

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
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const [resent, resendAction, resending] = useActionState<SignInState, FormData>(resendConfirmation, {});
  // Controlled, so a failed attempt keeps the address (the form action resets uncontrolled fields).
  const [email, setEmail] = useState('');
  const [issues, setIssues] = useState<CredentialIssues>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const error = resent.error ?? state.error ?? notice;
  const positive = resent.info ?? info;
  const canResend = offerResend || state.unverified === true;

  // After a refused attempt the password field is empty again: put the cursor there.
  useEffect(() => {
    if (state.error && !state.unverified) passwordRef.current?.focus();
  }, [state]);

  const check = (e: FormEvent<HTMLFormElement>): void => {
    const found = checkCredentials(email, passwordRef.current?.value ?? '', null);
    setIssues(found);
    if (!hasIssues(found)) return;
    e.preventDefault();
    (found.email ? emailRef : passwordRef).current?.focus();
  };
  const emailError = issues.email === 'required' ? ta.secX.required.email : issues.email === 'bad' ? ta.msg.account.emailBad : undefined;

  return (
    <form action={action} onSubmit={check} noValidate className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
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
        <Button type="submit" variant="secondary" formAction={resendAction} disabled={pending || resending} className="w-full whitespace-normal">
          {resending ? t.loading : ta.secX.resend}
        </Button>
      ) : null}
    </form>
  );
}

'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD, AuthResult, AuthTitle } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconBuilding, IconLock, IconMail, IconSparkle } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { PasswordInput } from '@/ui/password-input';
import { checkCredentials, hasIssues, MIN_PASSWORD_LENGTH, type CredentialIssues } from '../sign-in/credentials-check';
import { PasswordMeter } from '../sign-in/password-meter';

type SignUpState = { error?: string; checkEmail?: boolean };

export function SignUpForm() {
  const { t, ta } = useI18n();
  const x = ta.authX.signUp;
  const { follow, leaving } = useFollow();
  const [state, setState] = useState<SignUpState>({});
  // Controlled, so a refused attempt keeps what was typed (the password is cleared after every attempt).
  const [firm, setFirm] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [issues, setIssues] = useState<CredentialIssues>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const meterId = useId();
  const clearPassword = (): void => {
    if (passwordRef.current) passwordRef.current.value = '';
    setPassword('');
  };
  const signUp = useMutation({
    mutationFn: (body: { email: string; password: string; firm: string }) => api.auth.signUp(body),
    onSuccess: (answer) => { if (!follow(answer)) { clearPassword(); setState(answer as SignUpState); } },
    onError: () => { clearPassword(); setState({ error: t.errorGeneric }); },
  });
  const pending = signUp.isPending || leaving;
  if (state.checkEmail) {
    return (
      <AuthResult icon={<IconMail size={24} />} title={x.checkTitle}>
        <p>{ta.signup.checkEmail}</p>
        <p>{ta.authX.forgot.spam}</p>
      </AuthResult>
    );
  }

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    const typed = passwordRef.current?.value ?? '';
    const found = checkCredentials(email, typed, MIN_PASSWORD_LENGTH);
    setIssues(found);
    if (hasIssues(found)) {
      (found.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    signUp.mutate({ email, password: typed, firm });
  };
  const emailError = issues.email === 'required' ? ta.secX.required.email : issues.email === 'bad' ? ta.msg.account.emailBad : undefined;
  const passwordError = issues.password === 'required' ? ta.secX.required.password : issues.password === 'short' ? ta.msg.account.passwordShort : undefined;

  return (
    <>
      <AuthTitle title={ta.signup.title} lead={x.lead} className="mb-6" />
      {/* The trial is a benefit, said once, before the form. */}
      <div className="mb-6 flex items-start gap-3 rounded-md border border-brand/25 bg-brand-tint px-3.5 py-3 text-brand-ink">
        <IconSparkle size={18} className="mt-px shrink-0" />
        <p className="text-data"><span className="font-semibold">{x.trialTitle}.</span> {x.trialBody}</p>
      </div>
      <form onSubmit={submit} noValidate className="space-y-5">
        <Field label={ta.signup.firm} hint={x.firmHint}>
          <Input name="firm" maxLength={120} autoComplete="organization" size="lg" leadingIcon={<IconBuilding size={16} />} className={AUTH_FIELD} value={firm} onChange={(e) => setFirm(e.target.value)} />
        </Field>
        <Field label={t.email} error={emailError}>
          <Input
            ref={emailRef} name="email" type="email" required autoComplete="username" inputMode="email" size="lg" leadingIcon={<IconMail size={16} />} className={AUTH_FIELD}
            invalid={emailError !== undefined}
            value={email} onChange={(e) => { setEmail(e.target.value); setIssues((cur) => ({ ...cur, email: undefined })); }}
          />
        </Field>
        <div>
          <Field label={t.password} hint={ta.team.passwordHint} error={passwordError}>
            <PasswordInput
              ref={passwordRef} name="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" size="lg"
              leadingIcon={<IconLock size={16} />} className={AUTH_FIELD} invalid={passwordError !== undefined} aria-describedby={meterId}
              onChange={(e) => { setPassword(e.target.value); setIssues((cur) => ({ ...cur, password: undefined })); }}
            />
          </Field>
          <PasswordMeter id={meterId} password={password} min={MIN_PASSWORD_LENGTH} />
        </div>
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">{ta.signup.create}</Button>
        <p className="text-small text-muted">
          {ta.setX.signup.consentBefore}
          <Link href="/oferta" className="rounded-sm text-brand-ink underline">{ta.setX.signup.offer}</Link>
          {ta.setX.signup.and}
          <Link href="/maxfiylik" className="rounded-sm text-brand-ink underline">{ta.setX.signup.privacy}</Link>
          {ta.setX.signup.consentAfter}
        </p>
      </form>
    </>
  );
}

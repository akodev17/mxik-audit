'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { checkCredentials, hasIssues, MIN_PASSWORD_LENGTH, type CredentialIssues } from '../sign-in/credentials-check';

type SignUpState = { error?: string; checkEmail?: boolean };

export function SignUpForm() {
  const { t, ta } = useI18n();
  const { follow, leaving } = useFollow();
  const [state, setState] = useState<SignUpState>({});
  // Controlled, so a refused attempt keeps what was typed (the password is cleared after every attempt).
  const [firm, setFirm] = useState('');
  const [email, setEmail] = useState('');
  const [issues, setIssues] = useState<CredentialIssues>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const clearPassword = (): void => { if (passwordRef.current) passwordRef.current.value = ''; };
  const signUp = useMutation({
    mutationFn: (body: { email: string; password: string; firm: string }) => api.auth.signUp(body),
    onSuccess: (answer) => { if (!follow(answer)) { clearPassword(); setState(answer as SignUpState); } },
    onError: () => { clearPassword(); setState({ error: t.errorGeneric }); },
  });
  const pending = signUp.isPending || leaving;
  if (state.checkEmail) {
    return <p role="status" className="rounded-ctl border border-line bg-base p-6 text-sm shadow-pop">{ta.signup.checkEmail}</p>;
  }

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pending) return;
    const password = passwordRef.current?.value ?? '';
    const found = checkCredentials(email, password, MIN_PASSWORD_LENGTH);
    setIssues(found);
    if (hasIssues(found)) {
      (found.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    signUp.mutate({ email, password, firm });
  };
  const emailError = issues.email === 'required' ? ta.secX.required.email : issues.email === 'bad' ? ta.msg.account.emailBad : undefined;
  const passwordError = issues.password === 'required' ? ta.secX.required.password : issues.password === 'short' ? ta.msg.account.passwordShort : undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.signup.title}</h1>
      <Field label={ta.signup.firm}>
        <Input name="firm" maxLength={120} autoComplete="organization" value={firm} onChange={(e) => setFirm(e.target.value)} />
      </Field>
      <Field label={t.email} error={emailError}>
        <Input
          ref={emailRef} name="email" type="email" required autoComplete="username" invalid={emailError !== undefined}
          value={email} onChange={(e) => { setEmail(e.target.value); setIssues((cur) => ({ ...cur, email: undefined })); }}
        />
      </Field>
      <Field label={t.password} hint={ta.team.passwordHint} error={passwordError}>
        <Input ref={passwordRef} name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" invalid={passwordError !== undefined} />
      </Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger-ink">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">{pending ? t.loading : ta.signup.create}</Button>
      <p className="text-xs text-muted">
        {ta.setX.signup.consentBefore}
        <Link href="/oferta" className="text-brand-ink underline">{ta.setX.signup.offer}</Link>
        {ta.setX.signup.and}
        <Link href="/maxfiylik" className="text-brand-ink underline">{ta.setX.signup.privacy}</Link>
        {ta.setX.signup.consentAfter}
      </p>
      <p className="text-xs text-muted">{ta.signup.trialNote}</p>
    </form>
  );
}

'use client';

import Link from 'next/link';
import { useActionState, useRef, useState, type FormEvent } from 'react';
import { signUp, type SignUpState } from '@/app/actions/signup';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';
import { checkCredentials, hasIssues, MIN_PASSWORD_LENGTH, type CredentialIssues } from '../sign-in/credentials-check';

export function SignUpForm() {
  const { t, ta } = useI18n();
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUp, {});
  // Controlled, so a refused attempt keeps what was typed (the form action resets uncontrolled fields).
  const [firm, setFirm] = useState('');
  const [email, setEmail] = useState('');
  const [issues, setIssues] = useState<CredentialIssues>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  if (state.checkEmail) {
    return <p role="status" className="rounded-ctl border border-line bg-base p-6 text-sm shadow-pop">{ta.signup.checkEmail}</p>;
  }

  const check = (e: FormEvent<HTMLFormElement>): void => {
    const found = checkCredentials(email, passwordRef.current?.value ?? '', MIN_PASSWORD_LENGTH);
    setIssues(found);
    if (!hasIssues(found)) return;
    e.preventDefault();
    (found.email ? emailRef : passwordRef).current?.focus();
  };
  const emailError = issues.email === 'required' ? ta.secX.required.email : issues.email === 'bad' ? ta.msg.account.emailBad : undefined;
  const passwordError = issues.password === 'required' ? ta.secX.required.password : issues.password === 'short' ? ta.msg.account.passwordShort : undefined;

  return (
    <form action={action} onSubmit={check} noValidate className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
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

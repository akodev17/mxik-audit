'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { resendConfirmation, signIn, type SignInState } from '@/app/actions/auth';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

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
  const error = resent.error ?? state.error ?? notice;
  const positive = resent.info ?? info;
  const canResend = offerResend || state.unverified === true;
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{t.signIn}</h1>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label={t.email}>
        <Input id="email" name="email" type="email" required autoComplete="username" autoFocus />
      </Field>
      <Field label={t.password}>
        <Input id="password" name="password" type="password" required autoComplete="current-password" />
      </Field>
      {error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{error}</p> : null}
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

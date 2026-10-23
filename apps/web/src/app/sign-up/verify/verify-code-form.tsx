'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { Button } from '@/ui/button';
import { IconArrowLeft } from '@/ui/icons';
import { OtpInput } from '@/ui/otp-input';

const DIGITS = 6;

/** The six boxes, "send again" and a way out to another account. */
export function VerifyCodeForm() {
  const { t, ta } = useI18n();
  const v = ta.verifyX;
  const { follow, leaving } = useFollow();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const labelId = useId();
  const errorId = useId();
  const submit = useMutation({
    mutationFn: (code: string) => api.auth.verifyCode({ code }),
    onSuccess: (answer) => { if (!follow(answer)) setError('error' in answer ? answer.error ?? null : null); },
    onError: () => setError(t.errorGeneric),
    // A refused code is cleared; the cursor goes back to the first box.
    onSettled: () => setDigits(''),
  });
  const resend = useMutation({
    mutationFn: () => api.auth.resendCode(),
    onSuccess: (answer) => {
      if (follow(answer)) return;
      const state = answer as { error?: string; info?: string };
      setError(state.error ?? null);
      setInfo(state.info ?? null);
    },
    onError: () => setError(t.errorGeneric),
  });
  const signOut = useMutation({
    mutationFn: () => api.auth.signOut(),
    onSettled: (answer) => { follow(answer ?? { redirect: '/sign-in' }); },
  });
  const pending = submit.isPending || leaving;

  const send = (code: string): void => {
    if (pending || code.length < DIGITS) return;
    setError(null);
    setInfo(null);
    submit.mutate(code);
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    send(digits);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <p id={labelId} className="mb-1.5 text-data font-medium text-fg">{v.codeLabel}</p>
        <OtpInput
          name="code" value={digits} onChange={setDigits} onComplete={send} length={DIGITS}
          digitLabel={ta.authX.twoFactor.digit} labelledBy={labelId} describedBy={error ? errorId : undefined}
          invalid={error !== null} autoFocus
        />
      </div>
      {error ? <div id={errorId}><Alert tone="danger">{error}</Alert></div> : null}
      {info ? <Alert tone="good">{info}</Alert> : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={digits.length < DIGITS} className="w-full">
        {v.submit}
      </Button>
      <p className="text-small text-muted">{v.spam}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 text-body">
        <button type="button" onClick={() => resend.mutate()} disabled={resend.isPending} className="rounded-sm font-medium text-brand-ink hover:underline disabled:opacity-60">
          {v.resend}
        </button>
        <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending} className="inline-flex items-center gap-1.5 rounded-sm font-medium text-muted hover:text-fg">
          <IconArrowLeft size={16} />
          {v.otherAccount}
        </button>
      </div>
    </form>
  );
}

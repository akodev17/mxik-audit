'use client';

import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Alert } from '@/ui/alert';
import { AUTH_FIELD } from '@/ui/auth-parts';
import { Button } from '@/ui/button';
import { IconKey } from '@/ui/icons';
import { Field, Input } from '@/ui/input';
import { OtpInput } from '@/ui/otp-input';

const DIGITS = 6;

/** The six-digit code from the authenticator app, or (toggle) one of the saved recovery codes. */
export function TwoFactorForm() {
  const { t, ta } = useI18n();
  const x = ta.authX.twoFactor;
  const { follow, leaving } = useFollow();
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const [digits, setDigits] = useState('');
  const recoveryRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const errorId = useId();
  const submit = useMutation({
    mutationFn: (code: string) => api.auth.twoFactorSubmit({ code }),
    onSuccess: (answer) => { if (!follow(answer)) setError('error' in answer ? answer.error ?? null : null); },
    onError: () => setError(t.errorGeneric),
  });
  const pending = submit.isPending || leaving;

  const send = (code: string): void => {
    if (pending || !code.trim()) return;
    setError(null);
    submit.mutate(code.trim(), {
      // A refused code is cleared, as before; the cursor goes back to the start.
      onSettled: () => {
        setDigits('');
        if (recoveryRef.current) recoveryRef.current.value = '';
      },
    });
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    send(recovery ? recoveryRef.current?.value ?? '' : digits);
  };
  const toggle = (): void => {
    setRecovery((v) => !v);
    setDigits('');
    setError(null);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {recovery ? (
        <Field label={x.recoveryLabel} hint={x.recoveryHint}>
          <Input
            ref={recoveryRef} id="code" name="code" required autoComplete="one-time-code" autoFocus size="lg"
            leadingIcon={<IconKey size={16} />} spellCheck={false} autoCapitalize="none" className={`font-mono ${AUTH_FIELD}`}
            invalid={error !== null}
          />
        </Field>
      ) : (
        <div>
          <p id={labelId} className="mb-1.5 text-data font-medium text-fg">{ta.security.codeLabel}</p>
          <OtpInput
            name="code" value={digits} onChange={setDigits} onComplete={(code) => send(code)} length={DIGITS}
            digitLabel={x.digit} labelledBy={labelId} describedBy={error ? errorId : undefined}
            invalid={error !== null} autoFocus
          />
        </div>
      )}
      {error ? <div id={errorId}><Alert tone="danger">{error}</Alert></div> : null}
      <Button type="submit" variant="primary" size="lg" loading={pending} disabled={!recovery && digits.length < DIGITS} className="w-full">
        {ta.security.verify}
      </Button>
      <button type="button" onClick={toggle} className="mx-auto block rounded-sm text-body font-medium text-brand-ink hover:underline">
        {recovery ? x.useApp : x.useRecovery}
      </button>
    </form>
  );
}

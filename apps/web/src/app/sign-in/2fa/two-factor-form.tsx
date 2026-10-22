'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState } from 'react';
import { submitTwoFactor, type TwoFactorLoginState } from '@/app/actions/security';
import { Button } from '@/ui/button';
import { Field, Input } from '@/ui/input';

export function TwoFactorForm() {
  const { t, ta } = useI18n();
  const [state, action, pending] = useActionState<TwoFactorLoginState, FormData>(submitTwoFactor, {});
  return (
    <form action={action} className="space-y-4 rounded-ctl border border-line bg-base p-6 shadow-pop">
      <h1 className="text-lg">{ta.security.twoFactorTitle}</h1>
      <p className="text-sm text-muted">{ta.security.twoFactorText}</p>
      <Field label={ta.security.codeLabel}>
        <Input id="code" name="code" required autoComplete="one-time-code" inputMode="text" autoFocus />
      </Field>
      {state.error ? <p role="alert" className="rounded-ctl bg-danger-tint px-3 py-2 text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? t.loading : ta.security.verify}
      </Button>
    </form>
  );
}

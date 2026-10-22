'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api/browser';
import { useFollow } from '@/lib/api/follow';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { IconAlert } from '@/ui/icons';
import { Field, Input } from '@/ui/input';

const FORM_ID = 'close-account-form';

/** Danger zone: closing the account needs the admin's password; on success the API signs out and the browser leaves. */
export function CloseAccount({ days }: { days: number }) {
  const { ta } = useI18n();
  const s = ta.setX.data;
  const { follow, leaving } = useFollow();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const closing = useMutation({
    mutationFn: (value: string) => api.account.close({ password: value }),
    onSuccess: (answer) => {
      if (follow(answer)) return;
      setError('error' in answer ? answer.error : undefined);
    },
    onError: () => setError(ta.security.deleteFailed),
  });
  const pending = closing.isPending || leaving;

  const close = (): void => { setOpen(false); setPassword(''); setMissing(false); };

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>{s.closeButton}</Button>
      <Dialog
        open={open} onClose={close} dismissible={!pending} role="alertdialog" size="sm"
        icon={<IconAlert size={20} className="text-danger-ink" />}
        title={s.closeTitle} description={s.closeHint(days)}
        footer={(
          <>
            <Button variant="secondary" disabled={pending} onClick={close}>{ta.setX.team.cancel}</Button>
            <Button type="submit" form={FORM_ID} variant="danger" loading={pending}>{s.closeConfirm}</Button>
          </>
        )}
      >
        <form
          id={FORM_ID} noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            if (password.trim() === '') { setMissing(true); return; }
            closing.mutate(password);
          }}
        >
          <Field label={s.closePassword} required error={missing ? s.closeNoPassword : error}>
            <Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setMissing(false); }} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

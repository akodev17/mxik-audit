'use client';

import { useActionState, useState } from 'react';
import { closeAccount, type DeleteState } from '@/app/actions/security';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { IconAlert } from '@/ui/icons';
import { Field, Input } from '@/ui/input';

const FORM_ID = 'close-account-form';

/** Danger zone: closing the account needs the admin's password; on success the server signs out and redirects. */
export function CloseAccount({ days }: { days: number }) {
  const { ta } = useI18n();
  const s = ta.setX.data;
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [missing, setMissing] = useState(false);
  const [state, action, pending] = useActionState<DeleteState, FormData>(closeAccount, {});

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
          id={FORM_ID} action={action} noValidate
          onSubmit={(e) => { if (password.trim() === '') { e.preventDefault(); setMissing(true); } }}
        >
          <Field label={s.closePassword} required error={missing ? s.closeNoPassword : state.error}>
            <Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setMissing(false); }} />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

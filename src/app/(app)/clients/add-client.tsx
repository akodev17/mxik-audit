'use client';

import { useActionState, useState } from 'react';
import { addClient, type AddClientState } from '@/app/actions/clients';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { Field, Input } from '@/ui/input';

/** The page's primary action for writers: a dialog that creates the client and opens it. */
export function AddClient({ scoped, initialOpen = false }: { scoped: boolean; initialOpen?: boolean }) {
  const { ta } = useI18n();
  const words = ta.firmX.clients;
  const [open, setOpen] = useState(initialOpen);
  const [state, action, pending] = useActionState<AddClientState, FormData>(addClient, {});
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{words.add}</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={words.dialogTitle}
        size="sm"
        dismissible={!pending}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>{ta.shellX.ui.cancel}</Button>
            <Button type="submit" form="new-client-form" variant="primary" loading={pending}>{words.create}</Button>
          </>
        )}
      >
        <form id="new-client-form" action={action}>
          <Field label={words.nameLabel} hint={scoped ? `${words.nameHint} ${words.scopedNote}` : words.nameHint} error={state.error} required>
            <Input name="name" required minLength={2} maxLength={200} autoComplete="off" />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

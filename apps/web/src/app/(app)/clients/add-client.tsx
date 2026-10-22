'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';
import { addClient } from '@/app/actions/clients';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { Field, Input } from '@/ui/input';
import { goTo } from '@/ui/shell/same-route-links';

/** The page's primary action for writers: a dialog that creates the client and opens it. */
export function AddClient({ scoped, initialOpen = false }: { scoped: boolean; initialOpen?: boolean }) {
  const { ta } = useI18n();
  const words = ta.firmX.clients;
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const close = (): void => {
    setOpen(false);
    setError(undefined);
  };

  // The dialog closes before navigating, so it can never stay stuck behind a slow page load.
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setError(undefined);
    start(async () => {
      const result = await addClient(data).catch(() => ({ ok: false as const, error: words.createFailed }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      close();
      goTo(`/clients/${result.clientId}`, (href) => router.push(href));
    });
  };

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{words.add}</Button>
      <Dialog
        open={open}
        onClose={close}
        title={words.dialogTitle}
        size="sm"
        dismissible={!pending}
        footer={(
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>{ta.shellX.ui.cancel}</Button>
            <Button type="submit" form="new-client-form" variant="primary" loading={pending}>{words.create}</Button>
          </>
        )}
      >
        <form id="new-client-form" onSubmit={submit}>
          <Field label={words.nameLabel} hint={scoped ? `${words.nameHint} ${words.scopedNote}` : words.nameHint} error={error} required>
            <Input name="name" required minLength={2} maxLength={200} autoComplete="off" />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { orRefused } from '@/lib/api/refusal';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { Dialog } from '@/ui/dialog';
import { Field, Input } from '@/ui/input';
import { serverChange } from '@/ui/shell/router-cache';
import { goTo } from '@/ui/shell/same-route-links';

const MIN = 2;
const MAX = 200;

/** The page's primary action for writers: a dialog that creates the client and opens it. */
export function AddClient({ scoped, initialOpen = false }: { scoped: boolean; initialOpen?: boolean }) {
  const { ta } = useI18n();
  const words = ta.firmX.clients;
  const v = ta.mgX.clients;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(initialOpen);
  const [name, setName] = useState('');
  // Checked on submit, then live, so a mistake is not shouted while the name is still being typed.
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const trimmed = name.trim();
  const invalid = trimmed === '' ? v.nameRequired : trimmed.length < MIN ? v.nameShort : undefined;
  const shown = (checked ? invalid : undefined) ?? error;

  const close = (): void => {
    setOpen(false);
    setError(undefined);
    setChecked(false);
    setName('');
  };

  // The dialog closes before navigating, so it can never stay stuck behind a slow page load.
  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setChecked(true);
    setError(undefined);
    if (invalid) {
      input.current?.focus();
      return;
    }
    start(async () => {
      // Makes the new client the active one; the lists that will show it refresh when next opened (router-cache).
      const result = await orRefused(serverChange(api.clients.create({ name: trimmed })), words.createFailed);
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
        initialFocus={input}
        dismissible={!pending}
        footer={(
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>{ta.shellX.ui.cancel}</Button>
            <Button type="submit" form="new-client-form" variant="primary" loading={pending}>{words.create}</Button>
          </>
        )}
      >
        <form id="new-client-form" onSubmit={submit} noValidate>
          <Field label={words.nameLabel} hint={scoped ? `${words.nameHint} ${words.scopedNote}` : words.nameHint} error={shown} required>
            <Input
              ref={input} name="name" required minLength={MIN} maxLength={MAX} autoComplete="off"
              value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }}
            />
          </Field>
        </form>
      </Dialog>
    </>
  );
}

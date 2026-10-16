'use client';

import { useI18n } from '@/lib/locale-client';
import { useActionState, useEffect } from 'react';
import { addClient, rememberClient, type AddClientState } from '@/app/actions/clients';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';

export function NewClientForm() {
  const { t, ta } = useI18n();
  const [state, action, pending] = useActionState<AddClientState, FormData>(addClient, {});
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <Input name="name" required minLength={2} maxLength={200} placeholder={t.clientsNewName} aria-label={t.clientsNewName} className="max-w-md" />
      <Button type="submit" variant="primary" disabled={pending}>{pending ? t.loading : ta.clients.add}</Button>
      {state.error ? <p role="alert" className="w-full text-sm text-danger">{state.error}</p> : null}
    </form>
  );
}

/** Opening a client's page makes it the one the workspace and upload work on. */
export function RememberClient({ clientId }: { clientId: string }) {
  useEffect(() => {
    void rememberClient(clientId);
  }, [clientId]);
  return null;
}

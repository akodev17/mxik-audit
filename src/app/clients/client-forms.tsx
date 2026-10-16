'use client';

import { useActionState, useEffect } from 'react';
import { addClient, rememberClient, type AddClientState } from '@/app/actions/clients';
import { t } from '@/lib/i18n';

export function NewClientForm() {
  const [state, action, pending] = useActionState<AddClientState, FormData>(addClient, {});
  return (
    <form action={action} className="flex flex-wrap items-start gap-2">
      <input
        name="name" required minLength={2} maxLength={200} placeholder={t.clientsNewName}
        className="w-full max-w-md border border-rule px-3 py-2 text-sm focus:border-ink focus:outline-none"
      />
      <button type="submit" disabled={pending} className="bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50">
        {t.clientsCreate}
      </button>
      {state.error ? <p role="alert" className="w-full text-sm text-risk">{state.error}</p> : null}
    </form>
  );
}

/** Opening a client's page makes it the one report, review and upload work on. */
export function RememberClient({ clientId }: { clientId: string }) {
  useEffect(() => {
    void rememberClient(clientId);
  }, [clientId]);
  return null;
}

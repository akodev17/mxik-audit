'use client';

import { useEffect } from 'react';
import { api } from '@/lib/api/browser';

/** Opening a client's page makes it the one the workspace and upload work on. */
export function RememberClient({ clientId }: { clientId: string }) {
  useEffect(() => {
    // Best effort, as before: a refusal (archived, out of scope) leaves the active client as it was.
    api.clients.switchActive({ clientId }).catch(() => undefined);
  }, [clientId]);
  return null;
}

'use client';

import { useEffect } from 'react';
import { rememberClient } from '@/app/actions/clients';

/** Opening a client's page makes it the one the workspace and upload work on. */
export function RememberClient({ clientId }: { clientId: string }) {
  useEffect(() => {
    void rememberClient(clientId);
  }, [clientId]);
  return null;
}

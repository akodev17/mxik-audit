'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useState } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { useToast } from '../toast';
import { switchTarget } from './nav';

type Switched = { id: string; name: string };

/**
 * Makes a client the active one, then loads the page that shows it (switchTarget): the new
 * client's page, catalogues or filtered list. A document load, so every part of the frame reads
 * the new client at once and no same-route router transition is involved (./navigation).
 * Failures are reported, never hidden; on success the spinner stays until the page changes.
 */
export function useSwitchClient() {
  const pathname = usePathname();
  const toast = useToast();
  const { ta } = useI18n();
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = useCallback(async (clientId: string): Promise<Switched | null> => {
    setSwitching(clientId);
    try {
      const result = await api.clients.switchActive({ clientId });
      if (!result.ok) throw new Error(result.error);
      const target = switchTarget(pathname, window.location.search, clientId);
      if (target) window.location.assign(target);
      else window.location.reload();
      return result.client;
    } catch {
      setSwitching(null);
      toast(ta.shellX.client.failed, { tone: 'error' });
      return null;
    }
  }, [pathname, toast, ta]);

  return { switching, switchTo };
}

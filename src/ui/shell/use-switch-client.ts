'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { switchClient } from '@/app/actions/shell';
import { useI18n } from '@/lib/locale-client';
import { useToast } from '../toast';
import { switchTarget } from './nav';

type Switched = { id: string; name: string };

/**
 * Makes a client the active one. Pages about one client or catalogue move to the new client's
 * equivalent; every other page stays and refreshes. Failures are reported, never hidden.
 */
export function useSwitchClient() {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const { ta } = useI18n();
  const [switching, setSwitching] = useState<string | null>(null);

  const switchTo = useCallback(async (clientId: string): Promise<Switched | null> => {
    setSwitching(clientId);
    try {
      const result = await switchClient(clientId);
      if (!result.ok) {
        toast(ta.shellX.client.failed, { tone: 'error' });
        return null;
      }
      const target = switchTarget(pathname, window.location.search, clientId);
      if (target) router.push(target);
      else router.refresh();
      return result.client;
    } catch {
      toast(ta.shellX.client.failed, { tone: 'error' });
      return null;
    } finally {
      setSwitching(null);
    }
  }, [pathname, router, toast, ta]);

  return { switching, switchTo };
}

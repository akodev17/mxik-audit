'use client';

import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { invalidateShell } from './shell-queries';

/** A change has landed since the last refresh it caused. */
let changed = false;
/** Changes still on their way to the server. */
let inFlight = 0;
/** A page opened while a change was on its way: refreshed once the change has landed. */
let refreshWhenSettled: (() => void) | null = null;

/**
 * Wraps an API call (or a server action) that changes what other pages show. The API cannot
 * revalidate Next's router cache the way a server action's revalidatePath did, so pages fetched ahead
 * on intent (./intent-prefetch) or kept for Back may be older than the change: the next page opened
 * is refreshed once (RefreshAfterChange), and the shell's React Query answers (bell, palette) are
 * fetched again on their next use. A component that stays on its page calls router.refresh() itself
 * instead. The workspace shows a decision before the server has it; a page opened in that moment is
 * refreshed when the call returns, not before, or the refresh could still read the old data.
 */
export async function serverChange<T>(action: Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await action;
  } finally {
    inFlight -= 1;
    changed = true;
    if (inFlight === 0 && refreshWhenSettled) {
      const refresh = refreshWhenSettled;
      refreshWhenSettled = null;
      refresh();
    }
  }
}

/**
 * After a change, the first page the user moves to is shown at once from the router's cache and
 * refreshed in place. router.refresh() also drops every page Next keeps, so later moves fetch anew.
 */
export function RefreshAfterChange(): null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const address = `${usePathname()}?${useSearchParams().toString()}`;
  const shown = useRef(address);

  useEffect(() => {
    if (shown.current === address) return;
    shown.current = address;
    const refresh = (): void => {
      changed = false;
      router.refresh();
      void invalidateShell(queryClient);
    };
    if (inFlight > 0) refreshWhenSettled = refresh;
    else if (changed) refresh();
  }, [address, router, queryClient]);
  return null;
}

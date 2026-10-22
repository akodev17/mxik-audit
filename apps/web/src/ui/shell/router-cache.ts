'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** A change has landed since the last refresh it caused. */
let changed = false;
/** Changes still on their way to the server. */
let inFlight = 0;
/** A page opened while a change was on its way: refreshed once the change has landed. */
let refreshWhenSettled: (() => void) | null = null;

/**
 * Wraps a server action that changes what other pages show but does not revalidate them (workspace
 * decisions, undo, comments, flags, row edits: revalidating would re-render the workspace on every
 * keypress). Pages fetched ahead on intent (./intent-prefetch) or kept for Back may then be older
 * than the change, so the next page opened is refreshed once (RefreshAfterChange). The workspace
 * shows a decision before the server has it; a page opened in that moment is refreshed when the
 * action returns, not before, or the refresh could still read the old data.
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
 * Server actions that revalidate need no wrapper: Next drops its cache for them itself.
 */
export function RefreshAfterChange(): null {
  const router = useRouter();
  const address = `${usePathname()}?${useSearchParams().toString()}`;
  const shown = useRef(address);

  useEffect(() => {
    if (shown.current === address) return;
    shown.current = address;
    const refresh = (): void => {
      changed = false;
      router.refresh();
    };
    if (inFlight > 0) refreshWhenSettled = refresh;
    else if (changed) refresh();
  }, [address, router]);
  return null;
}

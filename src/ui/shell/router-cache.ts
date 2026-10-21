'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Set when a server action changed data without revalidating; cleared by the refresh it causes. */
let changed = false;

/**
 * Call after a server action that changed what other pages show but did not revalidate them
 * (workspace decisions, undo, comments, flags, row edits: revalidating would re-render the
 * workspace on every keypress). Pages fetched ahead on intent (./intent-prefetch) or kept for Back
 * may then be older than the change; the next page opened is refreshed once (RefreshAfterChange).
 */
export function markServerChange(): void {
  changed = true;
}

/**
 * After a marked change, the first page the user moves to is shown at once from the router's cache
 * and refreshed in place. router.refresh() also drops every page Next keeps, so later moves fetch
 * anew. Server actions that revalidate need no mark: Next drops its cache for them itself.
 */
export function RefreshAfterChange(): null {
  const router = useRouter();
  const address = `${usePathname()}?${useSearchParams().toString()}`;
  const shown = useRef(address);

  useEffect(() => {
    if (shown.current === address) return;
    shown.current = address;
    if (!changed) return;
    changed = false;
    router.refresh();
  }, [address, router]);
  return null;
}

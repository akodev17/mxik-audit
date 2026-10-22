'use client';

import { usePathname, useRouter } from 'next/navigation';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useCallback, useEffect, useRef, type FocusEvent, type PointerEvent } from 'react';

/** How long the pointer must rest on a link before its page is fetched: crossing the tab bar fetches nothing. */
export const INTENT_DELAY_MS = 50;

export type IntentHandlers = {
  onPointerEnter: (e: PointerEvent) => void;
  onPointerLeave: () => void;
  onPointerDown: (e: PointerEvent) => void;
  onFocus: (e: FocusEvent) => void;
};

/**
 * Fetches a section's whole page when the user shows the intent to open it (the pointer rests on its
 * link, keyboard focus, a touch), so the click usually finds it ready and the page appears without
 * the skeleton. A mouse press alone fetches nothing: the click follows within milliseconds, and a
 * full fetch still on its way makes Next wait for it instead of showing the loading skeleton it
 * already holds (on a slow network that was half a second without feedback; while a fetched-ahead
 * page is still on its way, ./navigation-progress shows the wait). <Link>'s own prefetch stops at the (app) loading boundary for these
 * dynamic pages. Next keeps a full prefetch for experimental.staleTimes.static (next.config.ts:
 * 30 s), and drops it on router.refresh(), which follows an API change (./router-cache).
 * Only the header tabs, the rail and link tab strips (src/ui/tabs.tsx) use it: rendering every
 * section on each page load would cost seven server renders per page, most of them never opened.
 */
export function useIntentPrefetch(): (href: string) => IntentHandlers {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback((): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  return useCallback((href: string): IntentHandlers => {
    const fetchNow = (): void => {
      cancel();
      // The open section is already on screen; Next skips a page it already holds fresh.
      if (href !== pathname) router.prefetch(href, { kind: PrefetchKind.FULL });
    };
    return {
      onPointerEnter: (e) => {
        cancel();
        // A touch has no hover: its pointerdown fetches.
        if (e.pointerType !== 'touch') timer.current = setTimeout(fetchNow, INTENT_DELAY_MS);
      },
      onPointerLeave: cancel,
      // A press ends the wait: the click navigates now, so a fetch would repeat the navigation's own.
      onPointerDown: (e) => {
        if (e.pointerType === 'touch') fetchNow();
        else cancel();
      },
      onFocus: (e) => {
        if (focusVisible(e.target)) fetchNow();
      },
    };
  }, [cancel, pathname, router]);
}

/** Keyboard focus only: a mouse press focuses the link too, and its pointerdown already fetched. */
function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return false;
  }
}

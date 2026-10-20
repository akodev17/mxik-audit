'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { PageSkeleton } from '../skeleton';
import { routeBoundaryKey } from './navigation';

/**
 * A fresh Suspense boundary for every page address, so a navigation inside one section commits
 * with the skeleton instead of a transition that React can stop waiting on (see ./navigation).
 */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const key = routeBoundaryKey(usePathname(), useSearchParams().toString());
  const shown = useRef(key);

  // The new boundary replaces the page, and the focused link or tab with it: keep keyboard and
  // screen-reader users in the content instead of back at the top of the document.
  useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    const active = document.activeElement;
    if (active === null || active === document.body) document.getElementById('main')?.focus({ preventScroll: true });
  }, [key]);

  return <Suspense key={key} fallback={<PageSkeleton />}>{children}</Suspense>;
}

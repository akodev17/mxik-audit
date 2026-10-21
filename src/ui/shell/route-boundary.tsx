'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { Profiler, Suspense, useEffect, useRef, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { PageSkeleton } from '../skeleton';
import { routeBoundaryKey } from './navigation';

/** NEXT_PUBLIC_PERF_PROFILE=1 with `next build --profile` (performance work only): page commits go to window.__perf. */
const PROFILE = process.env.NEXT_PUBLIC_PERF_PROFILE === '1';

declare global {
  interface Window {
    /** React commits of the page, read by scripts/perf-nav.ts. */
    __perf?: { phase: string; actualDuration: number; commitTime: number }[];
  }
}

const recordCommit: ProfilerOnRenderCallback = (_id, phase, actualDuration, _base, _start, commitTime) => {
  (window.__perf ??= []).push({ phase, actualDuration, commitTime });
};

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

  const page = <Suspense key={key} fallback={<PageSkeleton />}>{children}</Suspense>;
  return PROFILE ? <Profiler id="page" onRender={recordCommit}>{page}</Profiler> : page;
}

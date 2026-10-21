'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useReducer } from 'react';
import { internalTarget } from './navigation';

/** How long a router navigation may take before the safety net steps in. */
export const NAVIGATION_WATCHDOG_MS = 8000;
/** After the nudge, how long the router gets before the page is loaded as a document. */
const NUDGE_GRACE_MS = 1500;

declare global {
  interface Window {
    /** false = the watchdog only logs and nudges (end-to-end runs prove navigations commit without it). */
    __mxikNavigationFallback?: boolean;
  }
}

/** The navigation being watched: the address it started from, and its timer. */
let pending: { from: string; timer: number } | null = null;
/** A state update in the shell, set while the watchdog is mounted. */
let nudge: (() => void) | null = null;
/** Told when a watch starts or ends (NavigationProgress). */
const listeners = new Set<() => void>();
const notify = (): void => { for (const listener of listeners) listener(); };

const here = (): string => `${window.location.pathname}${window.location.search}`;

function stopWatching(): void {
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending = null;
  notify();
}

/**
 * Safety net for a router navigation that never commits. RouteBoundary fixes the cause found in
 * production (see ./navigation); this is a last resort. The navigation counts as committed once
 * the address changes, wherever it went (a redirect, a later navigation, Back). If it has not after
 * NAVIGATION_WATCHDOG_MS, the watchdog logs, nudges React with an unrelated update (which retries
 * a transition React stopped waiting on), and, unless switched off, loads the target as a document.
 */
export function watchNavigation(target: string): void {
  stopWatching();
  const from = here();
  const timer = window.setTimeout(() => {
    pending = null;
    notify();
    if (here() !== from) return;
    console.warn(`[navigation] ${target} did not commit within ${NAVIGATION_WATCHDOG_MS} ms`);
    nudge?.();
    if (window.__mxikNavigationFallback === false) return;
    window.setTimeout(() => { if (here() === from) window.location.assign(target); }, NUDGE_GRACE_MS);
  }, NAVIGATION_WATCHDOG_MS);
  pending = { from, timer };
  notify();
}

/** Watches in-app link clicks (capture phase, before React); the router does the navigation. */
export function NavigationWatchdog(): null {
  const address = `${usePathname()}?${useSearchParams().toString()}`;
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // A committed address change (or Back/Forward) ends the watch.
  useEffect(() => stopWatching(), [address]);

  useEffect(() => {
    nudge = tick;
    function onClick(e: MouseEvent): void {
      if (e.defaultPrevented) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const target = internalTarget({
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        download: link.hasAttribute('download'),
        button: e.button,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
      }, window.location.href);
      if (target) watchNavigation(target);
    }
    window.addEventListener('click', onClick, true);
    window.addEventListener('popstate', stopWatching);
    return () => {
      nudge = null;
      stopWatching();
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('popstate', stopWatching);
    };
  }, []);
  return null;
}

/** For NavigationProgress: called when a watch starts or ends. */
export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A watched navigation has not committed yet. */
export const navigationPending = (): boolean => pending !== null;

/** For code that navigates itself: the router navigates, the watchdog watches. */
export function goTo(href: string, push: (href: string) => void): void {
  const target = internalTarget({ href, target: null, download: false, button: 0, modified: false }, window.location.href);
  if (target) watchNavigation(target);
  push(href);
}

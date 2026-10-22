'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useReducer } from 'react';
import { addressKey, internalTarget, linkAddress, routerFetchAddress, watchVerdict, type LinkClick } from './navigation';

/** How long a router navigation may take before the safety net looks at it (and again after each look while the server works). */
export const NAVIGATION_WATCHDOG_MS = 8000;
/** After the nudge, how long the router gets before the page is loaded as a document. */
const NUDGE_GRACE_MS = 1500;

declare global {
  interface Window {
    /** false = the watchdog only logs and nudges (end-to-end runs prove navigations commit without it). */
    __mxikNavigationFallback?: boolean;
  }
}

/** The navigation being watched: where it started, where it goes, when (performance.now()), and its timer. */
let pending: { from: string; target: string; since: number; timer: number } | null = null;
/** A state update in the shell, set while the watchdog is mounted. */
let nudge: (() => void) | null = null;
/** Told when a watch starts or ends (NavigationProgress). */
const listeners = new Set<() => void>();
const notify = (): void => { for (const listener of listeners) listener(); };
/** When the last router fetch for each address finished arriving (performance.now() time), from the resource observer. */
const answered = new Map<string, number>();
/** The page the address moved to while its content was still loading (skeleton shown), and since when it was requested. */
let opening: { key: string; since: number } | null = null;

const here = (): string => `${window.location.pathname}${window.location.search}`;

function stopWatching(): void {
  if (!pending) return;
  window.clearTimeout(pending.timer);
  pending = null;
  notify();
}

/**
 * The page skeleton (src/ui/skeleton.tsx) is on screen: the address has already changed to the page
 * being opened, and its content is still on its way.
 */
const pageLoading = (): boolean => document.querySelector('[data-page-skeleton]') !== null;

/**
 * Whether a click or push to `address` would only repeat a navigation already on its way: the one
 * being watched, or the page whose skeleton is showing while its answer has not arrived. The router
 * would start the same server render again for each such click, and a person who sees nothing happen
 * clicks again and again; every click then made the page slower. Once the answer is there, a click
 * goes through as before.
 */
function alreadyOnItsWay(address: string): boolean {
  const key = addressKey(address);
  if (pending && addressKey(pending.target) === key) return true;
  if (!opening || opening.key !== key || addressKey(here()) !== key || !pageLoading()) return false;
  return (answered.get(key) ?? -1) < opening.since;
}

/**
 * Safety net for a router navigation that never commits. RouteBoundary fixes the cause found in
 * production (see ./navigation); this is a last resort. The navigation counts as committed once
 * the address changes, wherever it went (a redirect, a later navigation, Back). At each
 * NAVIGATION_WATCHDOG_MS it looks again: while the server has not answered, it keeps waiting (a slow
 * page is not a stuck one). Once the answer has arrived and nothing committed, it logs, nudges React
 * with an unrelated update (which retries a transition React stopped waiting on), and, unless switched
 * off, loads the target as a document.
 */
export function watchNavigation(target: string): void {
  stopWatching();
  const from = here();
  const since = performance.now();
  const look = (): void => {
    if (!pending) return;
    if (here() !== from) {
      stopWatching();
      return;
    }
    const arrived = (answered.get(addressKey(target)) ?? -1) >= since;
    if (watchVerdict(arrived, performance.now() - since) === 'wait') {
      pending.timer = window.setTimeout(look, NAVIGATION_WATCHDOG_MS);
      return;
    }
    stopWatching();
    console.warn(`[navigation] ${target} did not commit within ${Math.round(performance.now() - since)} ms${arrived ? ' of its answer' : ', and the server never answered'}`);
    nudge?.();
    if (window.__mxikNavigationFallback === false) return;
    window.setTimeout(() => { if (here() === from) window.location.assign(target); }, NUDGE_GRACE_MS);
  };
  pending = { from, target, since, timer: window.setTimeout(look, NAVIGATION_WATCHDOG_MS) };
  notify();
}

/** Watches in-app link clicks (capture phase, before React); the router does the navigation. */
export function NavigationWatchdog(): null {
  const address = `${usePathname()}?${useSearchParams().toString()}`;
  const [, tick] = useReducer((n: number) => n + 1, 0);

  // A committed address change (or Back/Forward) ends the watch. When it moved to the watched page,
  // that page may still be loading under its skeleton: remember since when.
  useEffect(() => {
    opening = pending && addressKey(pending.target) === addressKey(here()) ? { key: addressKey(pending.target), since: pending.since } : null;
    stopWatching();
  }, [address]);

  useEffect(() => {
    nudge = tick;
    function onClick(e: MouseEvent): void {
      if (e.defaultPrevented) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const click: LinkClick = {
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        download: link.hasAttribute('download'),
        button: e.button,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
      };
      const address = linkAddress(click, window.location.href);
      // The page is already on its way: <Link> skips a prevented click, so the router starts nothing new.
      if (address && alreadyOnItsWay(address)) {
        e.preventDefault();
        return;
      }
      const target = internalTarget(click, window.location.href);
      if (target) watchNavigation(target);
    }
    const origin = window.location.origin;
    // A resource entry is reported once the whole body has arrived.
    const observer = typeof PerformanceObserver === 'undefined' ? null : new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const fetched = routerFetchAddress(entry.name, origin);
        if (fetched) answered.set(fetched, (entry as PerformanceResourceTiming).responseEnd);
      }
    });
    try { observer?.observe({ type: 'resource' }); } catch { /* not supported: the watchdog then waits until it gives up */ }
    window.addEventListener('click', onClick, true);
    window.addEventListener('popstate', stopWatching);
    return () => {
      nudge = null;
      stopWatching();
      observer?.disconnect();
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

/** For code that navigates itself: the router navigates, the watchdog watches. A page already on its way is not requested again. */
export function goTo(href: string, push: (href: string) => void): void {
  const click: LinkClick = { href, target: null, download: false, button: 0, modified: false };
  const address = linkAddress(click, window.location.href);
  if (address && alreadyOnItsWay(address)) return;
  const target = internalTarget(click, window.location.href);
  if (target) watchNavigation(target);
  push(href);
}

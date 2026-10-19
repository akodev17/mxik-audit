'use client';

import { useEffect } from 'react';
import { documentHref, documentLinkTarget, internalTarget } from './navigation';

/** How long a router navigation may take before the page is loaded as a document instead. */
export const NAVIGATION_WATCHDOG_MS = 5000;

let pending: { target: string; timer: number } | null = null;

const here = (): string => `${window.location.pathname}${window.location.search}`;

/**
 * Safety net for router navigations that never commit (seen intermittently in the production
 * build: the request succeeds but the address and the page stay). If the address has not
 * reached `target` in time, the page is loaded as a document. Only the latest navigation counts.
 */
export function watchNavigation(target: string): void {
  if (pending) window.clearTimeout(pending.timer);
  const timer = window.setTimeout(() => {
    if (pending?.timer !== timer) return;
    pending = null;
    if (here() !== target) window.location.assign(target);
  }, NAVIGATION_WATCHDOG_MS);
  pending = { target, timer };
}

/**
 * Same-route link clicks (filter tabs, pagers, "clear filters", sibling records) load a new
 * document instead of a router navigation that can stay suspended (see ./navigation). Other
 * internal links keep the router but are watched. Runs in the capture phase, before React.
 */
export function useSameRouteLinks(): void {
  useEffect(() => {
    function onClick(e: MouseEvent): void {
      if (e.defaultPrevented) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const click = {
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        download: link.hasAttribute('download'),
        button: e.button,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
      };
      const to = documentLinkTarget(click, window.location.href);
      if (to) {
        e.preventDefault();
        window.location.assign(to);
        return;
      }
      const watched = internalTarget(click, window.location.href);
      if (watched) watchNavigation(watched);
    }
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);
}

/** For code that navigates itself: same-route targets load as a document, others use `push` under the watchdog. */
export function goTo(href: string, push: (href: string) => void): void {
  const to = documentHref(href, window.location.href);
  if (to) {
    window.location.assign(to);
    return;
  }
  const watched = internalTarget({ href, target: null, download: false, button: 0, modified: false }, window.location.href);
  push(href);
  if (watched) watchNavigation(watched);
}

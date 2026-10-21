// In-app navigation rules for the shell. Pure, so they can be tested.
//
// Why a boundary per address. In the production build <Link> prefetches dynamic pages only down to
// the (app) loading.tsx, and a navigation that stays inside one section (/clients -> /clients?filter=x,
// /clients -> /clients/<id>) keeps that boundary's state key. So React renders the new page as a
// transition under a boundary that already shows content, and the page arrives as streamed server
// component chunks. When React suspends on a chunk that resolves while it yields, it first decides
// to hold the transition and only then subscribes; the chunk answers at once, inside the render,
// and React drops that ping (Next 15.5's React 19.2 canary: throwException, pingSuspendedRoot).
// Nothing else wakes the root, so the address and page stayed put until an unrelated update.
// A boundary that is new for each address takes React's other path: it commits the skeleton and
// retries, as cross-section navigations always did.
//
// Rechecked 2026-10-21 on Next 15.5.23 / React 19.2.8 (docs/engineering/TAB_SWITCH_PERFORMANCE_REPORT.md):
// with one boundary per path for every page, e2e/navigation and e2e/refresh passed ten consecutive
// runs on a production build with the watchdog's fallback off. So pages that rebuild their query-
// driven parts themselves now change the query in place (QUERY_IN_PLACE): no skeleton, and no
// 300 ms wait for React to reveal content after one. List pages keep a boundary per address: their
// filter forms hold uncontrolled inputs that only a remount resets.

// The boundary key follows useSearchParams, which history.replaceState and pushState also update.
// A page that rewrites its own address that way must be listed below (whole page, or the param it
// removes), or each rewrite remounts it; navigation.test.ts checks the call sites.

/** Pages that rewrite their own query while staying mounted (the upload wizard's resume id): a change must not remount them. */
const KEEP_QUERY_STATE = /^\/upload$/;
/**
 * Pages whose query changes render in place, under one boundary: settings (each ?tab= is its own
 * panel, mounted fresh) and the workspace (its grid is keyed by catalogue and filter; density,
 * grouping and columns follow their props).
 */
const QUERY_IN_PLACE = /^\/(settings|catalogs\/[^/]+)$/;
/**
 * Query params a page reads once and then removes from the address itself: the Telegram bind
 * result in settings, and the row to open in the workspace. Removing them must not remount the page.
 * Every other query change on a list page is a new page.
 */
const CLIENT_ONLY_PARAMS = ['tg', 'row'];

/** Key of the page boundary: the path, plus the query except where the page keeps state in it. */
export function routeBoundaryKey(pathname: string, search: string): string {
  if (KEEP_QUERY_STATE.test(pathname) || QUERY_IN_PLACE.test(pathname)) return pathname;
  const params = new URLSearchParams(search);
  for (const name of CLIENT_ONLY_PARAMS) params.delete(name);
  const query = params.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

/** A URL, or null when it cannot be parsed against `base`. */
function parse(href: string, base: string | URL): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

// Held transitions outside navigation. router.refresh() and server actions keep the address, so the
// page boundary stays and RouteBoundary cannot help: their transition renders streamed chunks under
// content already on screen, and React drops the same ping. Measured in production: a bare refresh
// stayed uncommitted in 16 of 16 tries on the dashboard and 12 of 16 on a client page, and a closed
// dashboard task stayed listed until its toast went away 6 s later. Once a response has fully
// arrived, no chunk of it can resolve mid-render any more, so one unrelated state update after it
// makes React retry and commit (./response-nudge).

/** A finished fetch the router may be rendering: same origin, outside /api/ and /_next/ (router fetches carry ?_rsc=, server actions post to the page). */
export function isServerResponse(entry: { initiatorType: string; name: string }, origin: string): boolean {
  if (entry.initiatorType !== 'fetch') return false;
  const url = parse(entry.name, origin);
  return url !== null && url.origin === origin && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/');
}

export type Timer = { set: (run: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

/**
 * Calls `nudge` at least `delayMs` after every `responded()`, and at most once per `delayMs`: a burst
 * of responses (the link prefetches after a page load) costs one or two nudges, not one each.
 */
export function settleNudge(nudge: () => void, delayMs: number, timer: Timer): { responded: () => void; stop: () => void } {
  let handle: unknown = null;
  let armed = false;
  let again = false;
  const arm = (): void => {
    armed = true;
    again = false;
    handle = timer.set(() => {
      armed = false;
      nudge();
      if (again) arm();
    }, delayMs);
  };
  return {
    responded: () => {
      if (armed) again = true;
      else arm();
    },
    stop: () => {
      if (armed) timer.clear(handle);
      armed = false;
      again = false;
    },
  };
}

export type LinkClick = {
  href: string | null;
  target: string | null;
  download: boolean;
  /** MouseEvent.button: 0 is the main button. */
  button: number;
  /** Ctrl, Meta, Shift or Alt held: the browser opens a tab or window instead. */
  modified: boolean;
};

/** The in-app address (path and query) a click or push will reach, for the navigation watchdog; null for hash-only, external or browser-handled targets. */
export function internalTarget(click: LinkClick, current: string): string | null {
  if (click.button !== 0 || click.modified || click.download || !click.href) return null;
  if (click.target && click.target !== '_self') return null;
  const here = parse(current, 'http://localhost');
  const next = here ? parse(click.href, here) : null;
  if (!here || !next || next.origin !== here.origin) return null;
  if (!['http:', 'https:'].includes(next.protocol) || next.pathname.startsWith('/api/')) return null;
  const target = `${next.pathname}${next.search}`;
  return target === `${here.pathname}${here.search}` ? null : target;
}

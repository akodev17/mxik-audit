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

// The boundary key follows useSearchParams, which history.replaceState and pushState also update.
// A page that rewrites its own address that way must be listed below (whole page, or the param it
// removes), or each rewrite remounts it; navigation.test.ts checks the call sites.

/** Pages that rewrite their own query while staying mounted (the upload wizard's resume id): a change must not remount them. */
const KEEP_QUERY_STATE = /^\/upload$/;
/**
 * Query params a page reads once and then removes from the address itself: the Telegram bind
 * result in settings, and the row to open in the workspace. Removing them must not remount the page.
 * Every other query change is a new page (the workspace grid already remounts on each filter).
 */
const CLIENT_ONLY_PARAMS = ['tg', 'row'];

/** Key of the page boundary: the path, plus the query except where the page keeps state in it. */
export function routeBoundaryKey(pathname: string, search: string): string {
  if (KEEP_QUERY_STATE.test(pathname)) return pathname;
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

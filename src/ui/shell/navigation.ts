// Which in-app navigations must load a new document instead of going through the app router.
// Pure, so the rules can be tested.
//
// In the production build a router navigation that stays on the same route (only the query
// changes, or one record to its sibling: /clients/A -> /clients/B) renders as a transition with
// no fresh loading fallback, and on the heavier pages that transition can stay suspended for
// good: the request succeeds but the address and the page never change. QA saw it on the
// filter tabs, pagers and resets of /clients, /queue, /activity and /dashboard. Those
// navigations go by document; cross-section ones keep the router and the skeleton.

/** The workspace keeps its own query state (type chips, views) in the router, which works there. */
const WORKSPACE = /^\/catalogs\/[^/]+$/;

const segments = (pathname: string): string[] => pathname.split('/').filter(Boolean);

/** Same path with another query, or a sibling record (only the second segment differs). */
export function isSameRoute(current: URL, next: URL): boolean {
  if (next.origin !== current.origin) return false;
  if (next.pathname === current.pathname) return next.search !== current.search && !WORKSPACE.test(current.pathname);
  const a = segments(current.pathname);
  const b = segments(next.pathname);
  return a.length >= 2 && a.length === b.length && a[0] === b[0] && a[1] !== b[1] && a.slice(2).join('/') === b.slice(2).join('/');
}

/** A URL, or null when it cannot be parsed against `base`. */
function parse(href: string, base: string | URL): URL | null {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

/** Where to send the browser instead of the router, for a programmatic navigation to `href`. */
export function documentHref(href: string, current: string): string | null {
  const here = parse(current, 'http://localhost');
  const next = here ? parse(href, here) : null;
  return here && next && isSameRoute(here, next) ? `${next.pathname}${next.search}${next.hash}` : null;
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

/** The address a link click should load as a document, or null to leave the click alone. */
export function documentLinkTarget(click: LinkClick, current: string): string | null {
  if (click.button !== 0 || click.modified || click.download || !click.href) return null;
  if (click.target && click.target !== '_self') return null;
  return documentHref(click.href, current);
}

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

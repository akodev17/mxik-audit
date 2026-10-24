// Navigation model of the app shell. Pure, so the sidebar, the mobile menu, the command palette
// and the tests share one definition.
import { modulesOfRoute, strictest, type ModuleStates } from '@tasnivo/contracts/feature-modules';
import type { Locale } from '@tasnivo/i18n/i18n';

export type NavKey = 'dashboard' | 'queue' | 'clients' | 'catalogs' | 'upload' | 'dictionary' | 'activity' | 'help' | 'settings' | 'team' | 'bank' | 'didox' | 'products' | 'onec';
export type NavGroupKey = 'work' | 'clients' | 'accounting' | 'knowledge' | 'settings';
/** `soon`: the page's module is COMING_SOON, so the entry is shown but leads nowhere. */
export type NavEntry = { key: NavKey; href: string; soon?: boolean };
export type NavGroup = { key: NavGroupKey; items: NavEntry[] };

/** The help centre is public and has one tree per language. */
export const helpHref = (locale: Locale): string => (locale === 'ru' ? '/yordam/ru' : '/yordam');

/** Drops entries of HIDDEN modules (and groups left empty) and marks those of COMING_SOON ones. */
function withModules(groups: NavGroup[], modules: ModuleStates | undefined): NavGroup[] {
  if (!modules) return groups;
  return groups.map((g) => ({
    ...g,
    items: g.items.flatMap((item): NavEntry[] => {
      const state = strictest(modulesOfRoute(item.href), modules)?.state ?? 'ENABLED';
      if (state === 'HIDDEN') return [];
      return state === 'COMING_SOON' ? [{ ...item, soon: true }] : [item];
    }),
  })).filter((g) => g.items.length > 0);
}

/**
 * Sidebar groups in order; upload only for users who may change data, the team only for administrators
 * of a real organisation; module pages as `modules` (/admin/features) says.
 */
export function navGroups({ canWrite, canTeam = false, locale, modules }: { canWrite: boolean; canTeam?: boolean; locale: Locale; modules?: ModuleStates }): NavGroup[] {
  return withModules([
    { key: 'work', items: [{ key: 'dashboard', href: '/dashboard' }, { key: 'queue', href: '/queue' }] },
    {
      key: 'clients',
      items: [
        { key: 'clients', href: '/clients' },
        ...(canTeam ? [{ key: 'team' as const, href: '/team' }] : []),
        { key: 'catalogs', href: '/catalogs' },
        ...(canWrite ? [{ key: 'upload' as const, href: '/upload' }] : []),
      ],
    },
    // The accounting workflows (docs/TASNIVO_AI_PLAN_2026-10-23.md §5): source documents in, 1C-ready data out.
    {
      key: 'accounting',
      items: [{ key: 'bank', href: '/bank' }, { key: 'didox', href: '/didox' }, { key: 'products', href: '/products' }, { key: 'onec', href: '/onec' }],
    },
    {
      key: 'knowledge',
      items: [{ key: 'dictionary', href: '/dictionary' }, { key: 'activity', href: '/activity' }],
    },
    // Preferences sit at the bottom of the rail: help, then settings.
    { key: 'settings', items: [{ key: 'help', href: helpHref(locale) }, { key: 'settings', href: '/settings' }] },
  ], modules);
}

/** The link is the current section: the same path or one below it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * How many header tabs fit in `available` px, in order: all of them when they fit, otherwise as many
 * as fit beside the "more" button (`more` px) that lists the rest. `gap` is the space between items.
 */
export function fittingTabs(widths: readonly number[], available: number, more: number, gap: number): number {
  const row = (n: number): number => widths.slice(0, n).reduce((sum, w) => sum + w, 0) + Math.max(0, n - 1) * gap;
  if (row(widths.length) <= available) return widths.length;
  let n = widths.length - 1;
  while (n > 0 && row(n) + gap + more > available) n -= 1;
  return n;
}

const CLIENT_PAGE =/^\/clients\/([^/]+)/;
const CATALOG_PAGE = /^\/catalogs\/[^/]+/;
/** Lists that filter by a `client` query parameter. */
const CLIENT_LISTS = ['/queue', '/activity', '/catalogs', '/bank', '/didox', '/products', '/onec'];

/**
 * Where to go after switching to `clientId`, so the switch always shows: a client's page moves to
 * the new client's page, a catalogue to that client's catalogues, a list filtered by client to the
 * same list for the new client, and a firm-wide page to the client's page. Upload stays and
 * reloads (null), since it already works on the active client.
 */
export function switchTarget(pathname: string, search: string, clientId: string): string | null {
  const id = encodeURIComponent(clientId);
  if (CLIENT_PAGE.test(pathname)) return `/clients/${id}`;
  if (CATALOG_PAGE.test(pathname)) return `/catalogs?client=${id}`;
  if (CLIENT_LISTS.includes(pathname)) {
    const params = new URLSearchParams(search);
    params.set('client', clientId);
    params.delete('page');
    params.delete('after');
    return `${pathname}?${params.toString()}`;
  }
  if (isActive(pathname, '/upload')) return new URLSearchParams(search).has('client') ? '/upload' : null;
  return `/clients/${id}`;
}

/**
 * Where "all clients" in the header's client control leads: the same list without its client filter
 * (the catalogue list says so with client=all, since it defaults to the active client), the clients
 * list from a client's page, every catalogue from a catalogue, and the same page on firm-wide pages
 * (already all clients). Null on upload, which always works on one client.
 */
export function allClientsTarget(pathname: string, search: string): string | null {
  if (isActive(pathname, '/upload')) return null;
  if (CLIENT_PAGE.test(pathname)) return '/clients';
  if (CATALOG_PAGE.test(pathname)) return '/catalogs?client=all';
  const params = new URLSearchParams(search);
  if (CLIENT_LISTS.includes(pathname)) {
    params.delete('page');
    params.delete('after');
    if (pathname === '/catalogs') params.set('client', 'all');
    else params.delete('client');
  }
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * What the header's client control stands for on this page: the page's own client, the active
 * client (pages that default to it), all clients (firm-wide pages and unfiltered lists), or
 * nothing on a catalogue, whose header names its own client. `fallback` applies when the id is
 * not among the user's clients.
 */
export type SwitcherScope =
  | { kind: 'client'; id: string; fallback: 'all' | 'record' }
  | { kind: 'active' }
  | { kind: 'all' }
  | { kind: 'record' };

export function switcherScope(pathname: string, search: string): SwitcherScope {
  const page = CLIENT_PAGE.exec(pathname)?.[1];
  if (page) {
    try {
      return { kind: 'client', id: decodeURIComponent(page), fallback: 'record' };
    } catch {
      return { kind: 'record' };
    }
  }
  if (CATALOG_PAGE.test(pathname)) return { kind: 'record' };
  const client = new URLSearchParams(search).get('client');
  // The catalogue list shows the active client's catalogues until another choice is made.
  if (pathname === '/catalogs') return client === 'all' ? { kind: 'all' } : client ? { kind: 'client', id: client, fallback: 'all' } : { kind: 'active' };
  if (CLIENT_LISTS.includes(pathname)) return client ? { kind: 'client', id: client, fallback: 'all' } : { kind: 'all' };
  if (isActive(pathname, '/upload')) return client ? { kind: 'client', id: client, fallback: 'all' } : { kind: 'active' };
  return { kind: 'all' };
}

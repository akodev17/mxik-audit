// Navigation model of the app shell. Pure, so the sidebar, the mobile menu, the command palette
// and the tests share one definition.
import type { Locale } from '@/lib/i18n';

export type NavKey = 'dashboard' | 'queue' | 'clients' | 'catalogs' | 'upload' | 'dictionary' | 'activity' | 'help' | 'settings';
export type NavGroupKey = 'work' | 'clients' | 'knowledge' | 'settings';
export type NavEntry = { key: NavKey; href: string };
export type NavGroup = { key: NavGroupKey; items: NavEntry[] };

/** The help centre is public and has one tree per language. */
export const helpHref = (locale: Locale): string => (locale === 'ru' ? '/yordam/ru' : '/yordam');

/** Sidebar groups in order; upload only for users who may change data. */
export function navGroups({ canWrite, locale }: { canWrite: boolean; locale: Locale }): NavGroup[] {
  return [
    { key: 'work', items: [{ key: 'dashboard', href: '/dashboard' }, { key: 'queue', href: '/queue' }] },
    {
      key: 'clients',
      items: [
        { key: 'clients', href: '/clients' },
        { key: 'catalogs', href: '/catalogs' },
        ...(canWrite ? [{ key: 'upload' as const, href: '/upload' }] : []),
      ],
    },
    {
      key: 'knowledge',
      items: [{ key: 'dictionary', href: '/dictionary' }, { key: 'activity', href: '/activity' }, { key: 'help', href: helpHref(locale) }],
    },
    { key: 'settings', items: [{ key: 'settings', href: '/settings' }] },
  ];
}

/** The link is the current section: the same path or one below it. */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const CLIENT_PAGE = /^\/clients\/([^/]+)/;
const CATALOG_PAGE = /^\/catalogs\/[^/]+/;
/** Lists that filter by a `client` query parameter. */
const CLIENT_LISTS = ['/queue', '/activity', '/catalogs'];

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

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

const CLIENT_PAGE = /^\/clients\/[^/]+/;
const CATALOG_PAGE = /^\/catalogs\/[^/]+/;

/**
 * Where to go after switching to `clientId`: pages about one client or catalogue move to the new
 * client's equivalent; everything else stays put and refreshes (null).
 */
export function switchTarget(pathname: string, search: string, clientId: string): string | null {
  if (CLIENT_PAGE.test(pathname)) return `/clients/${encodeURIComponent(clientId)}`;
  if (CATALOG_PAGE.test(pathname)) return '/catalogs';
  if (isActive(pathname, '/upload') && new URLSearchParams(search).has('client')) return '/upload';
  return null;
}

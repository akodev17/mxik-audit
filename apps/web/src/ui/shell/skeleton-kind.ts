// Which page skeleton a path gets (./route-skeleton.tsx). Pure, so it is unit-tested.

export type SkeletonKind = 'dashboard' | 'list' | 'settings' | 'workspace' | 'record' | 'upload' | 'page';

const LISTS = ['/clients', '/catalogs', '/queue', '/dictionary', '/activity', '/notifications', '/team', '/admin'];

/** Which placeholder matches the page being opened, so the real page replaces it without a jump. */
export function skeletonKind(pathname: string): SkeletonKind {
  if (pathname === '/dashboard') return 'dashboard';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/upload')) return 'upload';
  if (/^\/catalogs\/[^/]+$/.test(pathname)) return 'workspace';
  if (/^\/clients\/[^/]+$/.test(pathname)) return 'record';
  if (LISTS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return 'list';
  return 'page';
}

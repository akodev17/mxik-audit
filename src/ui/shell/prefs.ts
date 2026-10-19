// Shell preferences kept in cookies so the server renders the right layout on the first paint.

/** auto: collapsed between md and lg, expanded from lg; the other two are the user's explicit choice. */
export type SidebarPref = 'auto' | 'collapsed' | 'expanded';

export const SIDEBAR_COOKIE = 'mxik_sidebar';

export const PREF_COOKIE_OPTIONS = { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' as const };

export function parseSidebar(value: unknown): SidebarPref {
  return value === 'collapsed' || value === 'expanded' ? value : 'auto';
}

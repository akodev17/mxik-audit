// Shell preferences kept in cookies so the server renders the right layout on the first paint.

/** auto: icons below xl, icons with names from xl; expanded: names from lg; collapsed: icons only. */
export type SidebarPref = 'auto' | 'collapsed' | 'expanded';

export const SIDEBAR_COOKIE = 'mxik_sidebar';

export const PREF_COOKIE_OPTIONS = { maxAge: 60 * 60 * 24 * 365, path: '/', sameSite: 'lax' as const };

export function parseSidebar(value: unknown): SidebarPref {
  return value === 'collapsed' || value === 'expanded' ? value : 'auto';
}

/** Whether the sidebar shows its names at this window width (px). */
export function sidebarLabelled(pref: SidebarPref, width: number): boolean {
  if (pref === 'collapsed') return false;
  return width >= (pref === 'expanded' ? 1024 : 1280);
}

/**
 * The sidebar cookie as the browser writes it the moment the toggle is clicked (B6): the API's PUT
 * sets the same cookie, but a reload before it answers cancels it and the choice was lost.
 */
export function sidebarCookie(pref: SidebarPref): string {
  return `${SIDEBAR_COOKIE}=${pref}; Max-Age=${PREF_COOKIE_OPTIONS.maxAge}; Path=${PREF_COOKIE_OPTIONS.path}; SameSite=Lax`;
}

/** The toggle always flips what is on screen: names shown → collapsed, icons only → expanded. */
export function toggledSidebar(labelledNow: boolean): Exclude<SidebarPref, 'auto'> {
  return labelledNow ? 'collapsed' : 'expanded';
}

/**
 * Tailwind classes keyed to `data-rail` on the frame (`group/frame`), so the server renders the
 * choice without a flash and CSS alone decides per width. Keep the widths in step with sidebarLabelled.
 */
export const RAIL = {
  /** Width of the sidebar column (and of nothing else). */
  width: 'w-16 lg:group-data-[rail=expanded]/frame:w-56 xl:group-data-[rail=auto]/frame:w-56',
  /** Shown only with names (flex items). */
  shown: 'hidden lg:group-data-[rail=expanded]/frame:flex xl:group-data-[rail=auto]/frame:flex',
  /** Shown only with names (inline text). */
  text: 'hidden lg:group-data-[rail=expanded]/frame:inline xl:group-data-[rail=auto]/frame:inline',
  /** Shown only as icons. */
  iconsOnly: 'flex lg:group-data-[rail=expanded]/frame:hidden xl:group-data-[rail=auto]/frame:hidden',
  /** Row layout of an item: centred icon, or icon and name from the left. */
  item: 'justify-center lg:group-data-[rail=expanded]/frame:justify-start xl:group-data-[rail=auto]/frame:justify-start',
} as const;

// Finding a step's spotlight target: the first of its data-tour keys that is on screen.

export type Rect = { top: number; left: number; width: number; height: number };

/** How long a step waits for its target to appear (the page may still be rendering). */
export const TARGET_WAIT_MS = 1500;
/** Space between the target and the edge of the spotlight cut-out. */
export const SPOTLIGHT_PAD = 6;

/** The first key, in priority order, for which `find` returns something; null when none does. */
export function resolveTarget<T>(keys: readonly string[], find: (key: string) => T | null): { key: string; found: T } | null {
  for (const key of keys) {
    const found = find(key);
    if (found !== null) return { key, found };
  }
  return null;
}

/** The first element marked `data-tour=<key>` that is rendered (tabs in a closed menu or drawer are not). */
export function findVisible(key: string, root: ParentNode = document): HTMLElement | null {
  const all = root.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(key)}"]`);
  for (const el of all) if (el.getClientRects().length > 0) return el;
  return null;
}

/** The spotlight cut-out: the target grown by `pad`, kept inside the viewport. */
export function spotlightRect(target: Rect, viewport: { width: number; height: number }, pad = SPOTLIGHT_PAD): Rect {
  const left = Math.max(0, target.left - pad);
  const top = Math.max(0, target.top - pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

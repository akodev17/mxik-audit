// Grid columns shared by the header and every row. The decision column is the
// last track and sticks to the right edge, so it stays visible when the grid
// is narrower than its columns. Chip tracks fit the uz/ru labels (the match
// column shows short band names; a longer label ends in an ellipsis, its full
// text in the title); code tracks fit a 17-digit mono code and its padding.
import type { OptionalColumn } from '@/lib/workspace-url';

export type ColumnKey = 'select' | 'no' | 'product' | OptionalColumn | 'decision';

const TRACK: Record<ColumnKey, string> = {
  select: '36px',
  no: '52px',
  product: 'minmax(200px,2fr)',
  status: '188px',
  current: 'minmax(172px,1fr)',
  suggested: 'minmax(180px,1.2fr)',
  match: '152px',
  decision: '232px',
};

const MIN: Record<ColumnKey, number> = { select: 36, no: 52, product: 200, status: 188, current: 172, suggested: 180, match: 152, decision: 232 };

const ORDER: ColumnKey[] = ['select', 'no', 'product', 'status', 'current', 'suggested', 'match', 'decision'];

/** Optional columns dropped first when the grid must fit a narrow space (the drawer is open). */
const DROP_ORDER: OptionalColumn[] = ['match', 'suggested', 'status'];

export type Layout = { keys: ColumnKey[]; template: string; minWidth: number };

/** Visible columns in order, their CSS grid template and the width below which the grid scrolls sideways. Viewers get no selection column. */
export function layoutFor(hidden: readonly OptionalColumn[], selectable: boolean): Layout {
  const off = new Set<ColumnKey>(selectable ? hidden : [...hidden, 'select']);
  const keys = ORDER.filter((k) => !off.has(k));
  return { keys, template: keys.map((k) => TRACK[k]).join(' '), minWidth: keys.reduce((s, k) => s + MIN[k], 0) };
}

/**
 * The layout for a grid that must not scroll sideways (null width: no limit).
 * Optional columns go one by one until the rest fits, so the sticky decision
 * column never covers half a code; the current code always stays.
 */
export function fitLayout(hidden: readonly OptionalColumn[], selectable: boolean, width: number | null): Layout {
  let layout = layoutFor(hidden, selectable);
  if (width === null) return layout;
  const off = [...hidden];
  for (const column of DROP_ORDER) {
    if (layout.minWidth <= width) break;
    if (off.includes(column)) continue;
    off.push(column);
    layout = layoutFor(off, selectable);
  }
  return layout;
}

/** Chip columns use a tighter cell padding, so the longest uz and ru status label fits whole. */
export const cellPad = (key: ColumnKey): string => (key === 'status' || key === 'match' ? 'px-2' : 'px-3');

/** Row heights of the two densities (40 / 32 px, as every table in the app) and of the sticky header. */
export const ROW_HEIGHT = { comfortable: 40, compact: 32 } as const;
export const HEADER_HEIGHT = 36;

// Grid columns shared by the header and every row. The decision column is the
// last track and sticks to the right edge, so it stays visible when the grid
// is narrower than its columns (a 1204px window with the drawer open).
import type { OptionalColumn } from '@/lib/view-params';

export type ColumnKey = 'select' | 'no' | 'product' | OptionalColumn | 'decision';

const TRACK: Record<ColumnKey, string> = {
  select: '36px',
  no: '52px',
  product: 'minmax(220px,2fr)',
  status: '136px',
  current: 'minmax(140px,1fr)',
  suggested: 'minmax(170px,1.2fr)',
  match: '128px',
  decision: '208px',
};

const MIN: Record<ColumnKey, number> = { select: 36, no: 52, product: 220, status: 136, current: 140, suggested: 170, match: 128, decision: 208 };

const ORDER: ColumnKey[] = ['select', 'no', 'product', 'status', 'current', 'suggested', 'match', 'decision'];

export type Layout = { keys: ColumnKey[]; template: string; minWidth: number };

/** Visible columns in order, their CSS grid template and the width below which the grid scrolls sideways. Viewers get no selection column. */
export function layoutFor(hidden: readonly OptionalColumn[], selectable: boolean): Layout {
  const off = new Set<ColumnKey>(selectable ? hidden : [...hidden, 'select']);
  const keys = ORDER.filter((k) => !off.has(k));
  return { keys, template: keys.map((k) => TRACK[k]).join(' '), minWidth: keys.reduce((s, k) => s + MIN[k], 0) };
}

import Link from 'next/link';
import { cx } from './cx';

export type RankedItem = {
  key: string;
  label: string;
  /** The count the row stands for. */
  value: number;
  /** Printed at the end of the row, pre-formatted (count and share). */
  display: string;
  /** Bar length as a share of the whole, 0 to 1: one scale for every row, so a bar is never exaggerated. */
  share: number;
  /** Makes the label a link to the list behind the row. */
  href?: string;
};

/**
 * Categories ranked by size: name and figures on one line with a full-width proportional bar beneath. The bar is the
 * row's share of the whole (0 to 100%, the same scale for every row), the largest row is in the brand
 * colour and the rest are lighter. Rows with no value are left out; with nothing left the list says so.
 */
export function RankedBars({ items, label, empty }: { items: readonly RankedItem[]; label: string; empty: string }) {
  const rows = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length === 0) return <p className="text-small text-muted">{empty}</p>;
  const top = rows[0]?.key;
  return (
    <ol aria-label={label} className="space-y-4">
      {rows.map((item) => {
        const pct = Math.max(1.5, Math.min(100, item.share * 100));
        const name = item.href
          ? <Link href={item.href} className="font-medium hover:text-brand-ink hover:underline">{item.label}</Link>
          : <span className="font-medium">{item.label}</span>;
        return (
          <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5">
            <span className="min-w-0 text-data [overflow-wrap:anywhere]">{name}</span>
            <span aria-hidden className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-sunken">
              <span className={cx('block h-full rounded-full transition-[width] duration-(--duration-base) ease-standard motion-reduce:transition-none', item.key === top ? 'bg-brand' : 'bg-brand/35')} style={{ width: `${pct}%` }} />
            </span>
            <span className="text-right text-small tabular-nums text-muted">
              <span className="font-medium text-fg">{item.display}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

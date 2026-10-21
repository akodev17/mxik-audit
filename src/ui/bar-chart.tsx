import Link from 'next/link';
import { cx } from './cx';

export type BarItem = {
  key: string;
  label: string;
  /** The count the bar is drawn for. */
  value: number;
  /** Printed above the bar, pre-formatted (count and share). */
  display: string;
  /** Makes the whole column a link to the list behind the bar. */
  href?: string;
};

/**
 * A short vertical bar chart for a handful of categories. Heights are proportional to the values from
 * a zero baseline (the tallest bar fills the track), the numbers are printed on the bars, and the
 * largest bar is the one in the brand colour. Columns link where a filtered list exists.
 */
export function BarChart({ items, label, height = 220 }: { items: readonly BarItem[]; label: string; height?: number }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const top = items.reduce((best, i) => (i.value > best.value ? i : best), items[0] ?? { key: '', value: 0 } as BarItem).key;
  return (
    <ol aria-label={label} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const pct = Math.max(4, Math.round((item.value / max) * 100));
        const column = (
          <>
            <span className="relative block overflow-hidden rounded-t-lg bg-surface" style={{ height }}>
              <span
                aria-hidden
                className={cx('absolute inset-x-0 bottom-0 block rounded-t-lg transition-[height] duration-(--duration-base) ease-standard motion-reduce:transition-none', item.key === top ? 'bg-brand' : 'bg-brand-tint')}
                style={{ height: `${pct}%` }}
              />
              <span className={cx('absolute inset-x-0 bottom-2 px-2 text-center text-small font-medium tabular-nums', item.key === top ? 'text-on-fill' : 'text-brand-ink')}>
                {item.display}
              </span>
            </span>
            <span className="mt-2 block text-center text-small text-muted [overflow-wrap:anywhere]">{item.label}</span>
          </>
        );
        return (
          <li key={item.key} className="min-w-0">
            {item.href
              ? <Link href={item.href} className="block rounded-t-lg transition-opacity duration-(--duration-fast) hover:opacity-90">{column}</Link>
              : <div>{column}</div>}
          </li>
        );
      })}
    </ol>
  );
}

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { Progress } from './progress';

export type StatRowTone = 'neutral' | 'good' | 'warn' | 'danger';

export type StatRowItem = {
  key: string;
  /** What is counted, in words (rows, clients, checks): never just "Total". */
  label: string;
  /** Pre-formatted; the row does not format. */
  value: ReactNode;
  /** The denominator or unit next to the value, e.g. "/ 107". */
  unit?: string;
  /** One line of context that says something the value does not. */
  hint?: ReactNode;
  /** Makes the cell a link to the list behind the number. */
  href?: string;
  tone?: StatRowTone;
  /** A thin progress bar under the value. */
  bar?: { done: number; total: number };
};

const VALUE: Record<StatRowTone, string> = { neutral: 'text-fg', good: 'text-good-ink', warn: 'text-warn-ink', danger: 'text-danger-ink' };

/**
 * A compact summary: three or four measures side by side, divided by hairlines, with no box of their
 * own. Every cell is centred and built from the same slots (label, value, bar, hint), so the numbers
 * and the hints line up across the row even when only one cell has a bar.
 */
export function StatRow({ items, label, size = 'md', bare = false }: { items: StatRowItem[]; label: string; size?: 'md' | 'lg'; bare?: boolean }) {
  const anyBar = items.some((i) => i.bar);
  return (
    <ul aria-label={label} className={cx('grid grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-line', !bare && 'border-y border-line')}>
      {items.map((item, i) => {
        const body = (
          <>
            <span className="line-clamp-2 flex min-h-9 items-center text-small text-muted" title={item.label}>{item.label}</span>
            <span className="mt-1 flex items-baseline justify-center gap-1.5">
              <span className={cx('tabular-nums', size === 'lg' ? 'text-[2.25rem] font-medium leading-10 tracking-tight' : 'text-title', VALUE[item.tone ?? 'neutral'])}>{item.value}</span>
              {item.unit ? <span className="text-small tabular-nums text-muted">{item.unit}</span> : null}
            </span>
            {anyBar ? (
              <span className="mt-2 block h-1.5 w-full max-w-[12rem]">
                {item.bar ? <Progress size="sm" tone="good" hideLabel label={item.label} value={item.bar.done} max={item.bar.total} /> : null}
              </span>
            ) : null}
            <span className="mt-1.5 block min-h-8 text-micro text-muted">{item.hint}</span>
          </>
        );
        // Two columns on a phone: the second column gets a rule on its left, the second row one on top.
        const cell = cx('flex h-full min-w-0 flex-col items-center px-3 py-4 text-center lg:px-5', i % 2 === 1 && 'max-lg:border-l max-lg:border-line', i >= 2 && 'max-lg:border-t max-lg:border-line');
        return (
          <li key={item.key} className="min-w-0">
            {item.href
              ? <Link href={item.href} className={cx(cell, 'rounded-ctl transition-colors duration-(--duration-fast) hover:bg-surface')}>{body}</Link>
              : <div className={cell}>{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

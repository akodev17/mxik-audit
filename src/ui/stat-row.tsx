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
 * own. Use it where a row of separate stat cards would compete with the work below it.
 */
export function StatRow({ items, label }: { items: StatRowItem[]; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-2 border-y border-line lg:grid-cols-4 lg:divide-x lg:divide-line">
      {items.map((item, i) => {
        const body = (
          <>
            <span className="line-clamp-2 text-small text-muted" title={item.label}>{item.label}</span>
            <span className="mt-auto flex items-baseline gap-1.5 pt-1.5">
              <span className={cx('text-title tabular-nums', VALUE[item.tone ?? 'neutral'])}>{item.value}</span>
              {item.unit ? <span className="text-small tabular-nums text-muted">{item.unit}</span> : null}
            </span>
            {item.bar ? <Progress className="mt-1.5" size="sm" tone="good" hideLabel label={item.label} value={item.bar.done} max={item.bar.total} /> : null}
            {item.hint ? <span className="mt-1 block text-micro text-muted">{item.hint}</span> : null}
          </>
        );
        // Two columns on a phone: the second row gets its own top rule, the left column no side padding.
        const cell = cx('flex h-full min-w-0 flex-col py-3 pr-4 lg:px-5 lg:first:pl-0', i % 2 === 1 && 'pl-4 max-lg:border-l max-lg:border-line', i >= 2 && 'max-lg:border-t max-lg:border-line');
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

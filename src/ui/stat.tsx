import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './cx';
import { IconChevron } from './icons';

export type StatTone = 'neutral' | 'good' | 'warn' | 'danger' | 'brand';

type Props = {
  label: string;
  /** Pre-formatted (fmtNumber, fmtPercent): the tile does not format. */
  value: ReactNode;
  hint?: ReactNode;
  /** Makes the whole tile one link, e.g. to the filtered list behind the number. */
  href?: string;
  /** Colours the value; the label must still say what it means. */
  tone?: StatTone;
  className?: string;
};

const VALUE: Record<StatTone, string> = {
  neutral: 'text-fg', good: 'text-good-ink', warn: 'text-warn-ink', danger: 'text-danger-ink', brand: 'text-brand-ink',
};

/** KPI tile: label, value, optional hint. */
export function Stat({ label, value, hint, href, tone = 'neutral', className }: Props) {
  const body = (
    <>
      <span className="flex items-start justify-between gap-2 text-small text-muted">
        {/* Two lines before an ellipsis: the label says what the number means (Russian runs long). */}
        <span data-stat-label className="line-clamp-2 min-w-0" title={label}>{label}</span>
        {href ? <IconChevron size={14} className="mt-0.5 shrink-0 text-subtle" /> : null}
      </span>
      {/* mt-auto: in a row of tiles the numbers line up even when one label takes two lines. */}
      <span className={cx('mt-auto block pt-1 text-title tabular-nums', VALUE[tone])}>{value}</span>
      {hint ? <span className="mt-0.5 block text-micro text-muted">{hint}</span> : null}
    </>
  );
  const box = cx('flex min-w-0 flex-col rounded-ctl border border-line bg-raised px-4 py-3', className);
  if (!href) return <div className={box}>{body}</div>;
  return (
    <Link href={href} className={cx(box, 'transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface')}>
      {body}
    </Link>
  );
}

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
      <span className="flex items-center justify-between gap-2 text-small text-muted">
        <span className="truncate">{label}</span>
        {href ? <IconChevron size={14} className="shrink-0 text-subtle" /> : null}
      </span>
      <span className={cx('mt-1 block text-title tabular-nums', VALUE[tone])}>{value}</span>
      {hint ? <span className="mt-0.5 block text-micro text-muted">{hint}</span> : null}
    </>
  );
  const box = cx('block min-w-0 rounded-ctl border border-line bg-raised px-4 py-3', className);
  if (!href) return <div className={box}>{body}</div>;
  return (
    <Link href={href} className={cx(box, 'transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface')}>
      {body}
    </Link>
  );
}

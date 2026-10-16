import type { ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'neutral' | 'danger' | 'warn' | 'good' | 'brand';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface text-muted',
  danger: 'bg-danger-tint text-danger',
  warn: 'bg-warn-tint text-warn-ink',
  good: 'bg-good-tint text-good',
  brand: 'bg-brand-tint text-brand',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-muted', danger: 'bg-danger', warn: 'bg-warn', good: 'bg-good', brand: 'bg-brand',
};

type Props = { tone?: Tone; children: ReactNode; title?: string; className?: string };

/** Small pill for counts and labels. */
export function Badge({ tone = 'neutral', children, title, className }: Props) {
  return (
    <span title={title} className={cx('inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-xs font-medium', TONE[tone], className)}>
      {children}
    </span>
  );
}

/** Status with a coloured dot; colour carries the meaning, the label repeats it. */
export function StatusChip({ tone = 'neutral', children, title }: Props) {
  return (
    <span title={title} className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium', TONE[tone])}>
      <span aria-hidden className={cx('size-1.5 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

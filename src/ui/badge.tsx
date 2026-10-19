import type { ReactNode } from 'react';
import { cx } from './cx';
import { IconAlert, IconError, IconInfo, IconSuccess } from './icons';

export type Tone = 'neutral' | 'danger' | 'warn' | 'good' | 'brand' | 'info';

// Text uses the -ink colour of each family: >= 4.5:1 on its tint in both themes.
const TONE: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  danger: 'bg-danger-tint text-danger-ink',
  warn: 'bg-warn-tint text-warn-ink',
  good: 'bg-good-tint text-good-ink',
  brand: 'bg-brand-tint text-brand-ink',
  info: 'bg-info-tint text-info-ink',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-subtle', danger: 'bg-danger', warn: 'bg-warn', good: 'bg-good', brand: 'bg-brand', info: 'bg-info',
};

type Props = {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  className?: string;
  /** Replaces the dot (StatusChip) or leads the text (Badge); StatusIcon gives the standard one per tone. */
  icon?: ReactNode;
};

/** Small pill for counts and labels. */
export function Badge({ tone = 'neutral', children, title, className, icon }: Props) {
  return (
    <span title={title} className={cx('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-full px-2 text-micro font-medium', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Status: a dot or icon plus a label, so the meaning never rests on colour alone. */
export function StatusChip({ tone = 'neutral', children, title, className, icon }: Props) {
  return (
    <span title={title} className={cx('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-micro font-medium', TONE[tone], className)}>
      {icon ?? <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

/** The standard icon for a tone: tick for good, triangle for warn, cross for danger, i for info and brand. */
export function StatusIcon({ tone, size = 14 }: { tone: Tone; size?: number }) {
  if (tone === 'good') return <IconSuccess size={size} />;
  if (tone === 'warn') return <IconAlert size={size} />;
  if (tone === 'danger') return <IconError size={size} />;
  if (tone === 'neutral') return <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', DOT.neutral)} />;
  return <IconInfo size={size} />;
}

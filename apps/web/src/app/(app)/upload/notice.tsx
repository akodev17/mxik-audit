import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';
import { IconAlert, IconError, IconInfo, IconSuccess } from '@/ui/icons';

type Tone = 'danger' | 'warn' | 'info' | 'good';

const BOX: Record<Tone, string> = {
  danger: 'border-danger/40 bg-danger-tint text-danger-ink',
  warn: 'border-warn/50 bg-warn-tint text-warn-ink',
  info: 'border-info/40 bg-info-tint text-info-ink',
  good: 'border-good/40 bg-good-tint text-good-ink',
};

const ICON: Record<Tone, ReactNode> = {
  danger: <IconError size={18} />, warn: <IconAlert size={18} />, info: <IconInfo size={18} />, good: <IconSuccess size={18} />,
};

/** A banner: colour, icon and text together. Errors are announced (role=alert), the rest politely. */
export function Notice({ tone, title, children, action, className }: { tone: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex gap-2.5 rounded-ctl border px-3.5 py-2.5 text-small', BOX[tone], className)}>
      <span aria-hidden className="mt-px shrink-0">{ICON[tone]}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cx(title ? 'mt-0.5' : undefined)}>{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

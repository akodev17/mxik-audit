import type { ReactNode } from 'react';
import { StatusIcon } from './badge';
import { cx } from './cx';

export type AlertTone = 'info' | 'good' | 'warn' | 'danger';

// Border and ink of each family: text is the -ink colour, >= 4.5:1 on its tint in both themes.
const TONE: Record<AlertTone, string> = {
  info: 'border-info bg-info-tint text-info-ink', good: 'border-good bg-good-tint text-good-ink',
  warn: 'border-warn bg-warn-tint text-warn-ink', danger: 'border-danger bg-danger-tint text-danger-ink',
};

/** An inline message. Danger is announced at once (role=alert); the others politely (role=status). */
export function Alert({ tone, children, className }: { tone: AlertTone; children: ReactNode; className?: string }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex items-start gap-2 rounded-ctl border px-3 py-2 text-small', TONE[tone], className)}>
      <span className="mt-0.5 shrink-0"><StatusIcon tone={tone} size={14} /></span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

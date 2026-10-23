import type { ReactNode } from 'react';
import { StatusIcon } from './badge';
import { cx } from './cx';

export type AlertTone = 'info' | 'good' | 'warn' | 'danger';

// Text is the -ink colour of each family, >= 4.5:1 on its tint in both themes. The border is the
// fill at reduced strength: the tint carries the tone, the edge stays calm.
const TONE: Record<AlertTone, string> = {
  info: 'border-info/40 bg-info-tint text-info-ink', good: 'border-good/40 bg-good-tint text-good-ink',
  warn: 'border-warn/60 bg-warn-tint text-warn-ink', danger: 'border-danger/40 bg-danger-tint text-danger-ink',
};

type Props = {
  tone: AlertTone;
  children: ReactNode;
  className?: string;
  /** Bold first line; the children become the explanation under it. */
  title?: ReactNode;
  /** A button or link that resolves the message (retry, reset the password). */
  action?: ReactNode;
  /** Replaces the tone's standard icon. */
  icon?: ReactNode;
};

/** An inline message. Danger is announced at once (role=alert); the others politely (role=status). */
export function Alert({ tone, children, className, title, action, icon }: Props) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cx('flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-data', TONE[tone], className)}>
      <span aria-hidden className="mt-px inline-flex shrink-0">{icon ?? <StatusIcon tone={tone} size={16} />}</span>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {title ? <div className="mt-0.5">{children}</div> : children}
        {action ? <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

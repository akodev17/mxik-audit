import type { ReactNode } from 'react';
import { cx } from './cx';
import { IconAlert, IconEmpty } from './icons';

type Props = {
  title: string;
  hint?: string;
  /** Slot for the next step: a button, a link or a small group of them. */
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
  /** Replaces the default tray (neutral) or warning (danger) icon. */
  icon?: ReactNode;
  /** compact sits inside a card or table; default fills a page section. */
  size?: 'default' | 'compact';
  /** Heading level, so the state fits the page outline (h2 by default). */
  as?: 'h2' | 'h3';
};

/** Nothing to show, or something went wrong: say which and what to do next. */
export function EmptyState({ title, hint, action, tone = 'neutral', icon, size = 'default', as: Heading = 'h2' }: Props) {
  const danger = tone === 'danger';
  return (
    <div className={cx('mx-auto flex max-w-md flex-col items-center px-6 text-center', size === 'compact' ? 'py-8' : 'py-16')}>
      <span aria-hidden className={cx('mb-4 grid size-12 place-items-center rounded-full', danger ? 'bg-danger-tint text-danger-ink' : 'bg-sunken text-muted')}>
        {icon ?? (danger ? <IconAlert size={22} /> : <IconEmpty size={22} />)}
      </span>
      <Heading className="text-section">{title}</Heading>
      {hint ? <p className="mt-1 text-small text-muted">{hint}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

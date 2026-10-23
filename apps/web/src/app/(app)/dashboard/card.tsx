import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';

/**
 * One block of the dashboard: a raised card with its h2, at most one line of hint, actions on the right,
 * the body and an optional footer link. The section is a region named by its heading, so tests and screen
 * readers find it by title; keep counts and badges out of the h2.
 */
export function Card({ id, title, hint, actions, footer, children, flush = false, className }: {
  id: string;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** The body runs to the card's edges (lists with their own row padding, tables). */
  flush?: boolean;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={cx('relative min-w-0 rounded-lg border border-line bg-raised', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 pb-3 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-section">{title}</h2>
          {hint ? <p className="mt-0.5 text-small text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={flush ? undefined : 'px-4 pb-4 sm:px-5 sm:pb-5'}>{children}</div>
      {footer ? <div className="border-t border-line px-4 py-2.5 sm:px-5">{footer}</div> : null}
    </section>
  );
}

/** The quiet "see everything" link at the foot of a card. */
export const FOOT_LINK = 'inline-flex items-center gap-1 text-small font-medium text-brand-ink hover:underline';

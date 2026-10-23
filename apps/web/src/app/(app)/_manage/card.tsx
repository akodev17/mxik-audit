import type { ReactNode } from 'react';
import { cx } from '@/ui/cx';

type Props = {
  title?: string;
  /** One sentence under the title. */
  hint?: ReactNode;
  /** Controls on the title line (a link, a small button). */
  actions?: ReactNode;
  /** The card's own save or next step, right-aligned on a quiet strip. */
  footer?: ReactNode;
  /** danger: the account's danger zone. */
  tone?: 'default' | 'danger';
  /** The body has no padding: a table or list fills the card edge to edge. */
  flush?: boolean;
  /** Heading level inside the page outline. */
  as?: 'h2' | 'h3';
  id?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * One block of a management page: a raised surface with a hairline border and 12px radius, an
 * optional title row and an optional footer for the card's save. Cards are never nested.
 * Local to U5 until a Card primitive exists (see "Primitive requests" in docs/UI_REFRESH_PLAN.md).
 */
export function Card({ title, hint, actions, footer, tone = 'default', flush = false, as: Heading = 'h2', id, className, children }: Props) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title && headingId ? headingId : undefined}
      aria-label={title && !headingId ? title : undefined}
      className={cx(
        'relative min-w-0 scroll-mt-6 rounded-lg border bg-raised',
        tone === 'danger' ? 'border-danger/50' : 'border-line',
        className,
      )}
    >
      {title ? (
        <div className={cx('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5', flush ? 'pb-4' : undefined)}>
          <div className="min-w-0">
            <Heading id={headingId} className={cx('text-section', tone === 'danger' && 'text-danger-ink')}>{title}</Heading>
            {hint ? <p className="mt-0.5 max-w-2xl text-small text-muted">{hint}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined && children !== null ? (
        flush
          ? <div className={cx('relative overflow-hidden', title ? 'border-t border-line' : 'rounded-t-lg', footer ? undefined : 'rounded-b-lg')}>{children}</div>
          : <div className={cx('relative px-4 pb-4 sm:px-5 sm:pb-5', title ? 'pt-4' : 'pt-4 sm:pt-5')}>{children}</div>
      ) : null}
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-b-lg border-t border-line bg-surface px-4 py-3 sm:px-5">{footer}</div>
      ) : null}
    </section>
  );
}

/** Classes for a Table placed in a flush Card: the card draws the frame. */
export const FLUSH_TABLE = 'rounded-none! border-0!';

/** A label and a value in a card's definition list. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-small text-muted">{label}</dt>
      <dd className="mt-0.5 text-data font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Cards stacked with the page's 16px rhythm. */
export function CardStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('space-y-4', className)}>{children}</div>;
}

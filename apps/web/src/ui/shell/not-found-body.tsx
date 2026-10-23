import type { ReactNode } from 'react';
import { cx } from '../cx';
import { TasnivoMark } from '../logo';

/**
 * Shared body of the not-found and error pages: the brand mark on a tile, a short code ("404", or an error
 * reference), the h1, one sentence of what may have happened, and where to go next.
 */
export function NotFoundBody({ title, hint, actions, code = '404', tone = 'neutral', children }: {
  title: string;
  hint: string;
  actions: ReactNode;
  /** Shown above the title in mono. */
  code?: string;
  tone?: 'neutral' | 'danger';
  /** Extra detail under the actions (the error page's reference in development). */
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16 text-center sm:py-24">
      <span aria-hidden className="relative mb-6 grid size-16 place-items-center rounded-2xl border border-line bg-raised shadow-sm">
        <TasnivoMark className="size-8 text-fg" />
        <span className={cx('absolute -bottom-1 -right-1 size-4 rounded-full ring-4 ring-base', tone === 'danger' ? 'bg-danger' : 'bg-warn')} />
      </span>
      <p className="font-mono text-small font-medium tracking-wide text-subtle">{code}</p>
      <h1 className="mt-1.5 text-title">{title}</h1>
      <p className="mt-2 max-w-sm text-small text-muted">{hint}</p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      {children}
    </div>
  );
}

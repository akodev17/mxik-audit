// Pieces of auth pages shared by server pages and client forms (no server-only imports here).
import Link from 'next/link';
import type { ReactNode } from 'react';
import { StatusIcon } from './badge';
import { cx } from './cx';

/** Title and one sentence above an auth form. */
export function AuthTitle({ title, lead, className }: { title: string; lead?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-8', className)}>
      <h1 className="text-title">{title}</h1>
      {lead ? <p className="mt-2 text-body text-muted">{lead}</p> : null}
    </div>
  );
}

/**
 * A finished step (link sent, account created) or a dead end (expired link): an icon tile, a
 * title, what happens next, and the next action.
 */
export function AuthResult({ tone = 'good', icon, title, children, action, role = 'status' }: {
  tone?: 'good' | 'info' | 'danger';
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** status for a confirmation; none for a page whose whole point is the message (expired link). */
  role?: 'status' | 'none';
}) {
  const tile = { good: 'bg-good-tint text-good-ink', info: 'bg-brand-tint text-brand-ink', danger: 'bg-danger-tint text-danger-ink' }[tone];
  return (
    <div role={role === 'status' ? 'status' : undefined}>
      <span aria-hidden className={cx('mb-6 grid size-12 place-items-center rounded-xl', tile)}>
        {icon ?? <StatusIcon tone={tone} size={24} />}
      </span>
      <h1 className="text-title">{title}</h1>
      {children ? <div className="mt-2 space-y-2 text-body text-muted">{children}</div> : null}
      {action ? <div className="mt-8 flex flex-col gap-3">{action}</div> : null}
    </div>
  );
}

/** "or" between the main form and another way in (Telegram). */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3 text-small text-muted" role="separator" aria-label={label}>
      <span aria-hidden className="h-px flex-1 bg-line" />
      <span aria-hidden>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </div>
  );
}

/** Small link line under a form ("No account? Create one"). */
export function AuthSwitch({ text, href, action }: { text: string; href: string; action: string }) {
  return (
    <p className="mt-8 text-center text-body text-muted">
      {text}{' '}
      <Link href={href} className="rounded-sm font-medium text-brand-ink hover:underline">{action}</Link>
    </p>
  );
}

/** Field class for auth forms: 16px text on phones, so iOS does not zoom in on focus. */
export const AUTH_FIELD = 'max-sm:text-[16px]';

import Link from 'next/link';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';
/** compact fits inside dense table and grid rows; sm and md follow the control heights. */
export type ButtonSize = 'compact' | 'sm' | 'md';

// Hover and press states skip disabled buttons; links (ButtonLink) are never :disabled, so they keep them.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-transparent bg-brand text-on-fill not-disabled:hover:bg-brand-hover not-disabled:active:bg-brand-active',
  secondary: 'border-line-strong bg-raised text-fg not-disabled:hover:border-line-input not-disabled:hover:bg-surface not-disabled:active:bg-sunken',
  ghost: 'border-transparent bg-transparent text-muted not-disabled:hover:bg-surface not-disabled:hover:text-fg not-disabled:active:bg-sunken',
  // Quiet until pointed at: a row of delete buttons must not shout.
  danger: 'border-line-strong bg-raised text-danger-ink not-disabled:hover:border-danger not-disabled:hover:bg-danger not-disabled:hover:text-on-fill not-disabled:active:bg-danger-ink',
  'danger-ghost': 'border-transparent bg-transparent text-danger-ink not-disabled:hover:bg-danger-tint not-disabled:active:bg-danger-tint',
};

const SIZE: Record<ButtonSize, string> = {
  compact: 'h-control-inline gap-1 px-2 text-small',
  sm: 'h-control-compact gap-1.5 px-3 text-data',
  md: 'h-control-md gap-2 px-3.5 text-data',
};

// Square buttons that hold only an icon (IconButton).
const SQUARE: Record<ButtonSize, string> = {
  compact: 'size-control-inline',
  sm: 'size-control-compact',
  md: 'size-control-md',
};

const BASE = cx(
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-ctl border font-medium',
  'transition-colors duration-(--duration-fast) ease-standard',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string): string {
  return cx(BASE, VARIANT[variant], SIZE[size], extra);
}

export function iconButtonClass(variant: ButtonVariant = 'ghost', size: ButtonSize = 'sm', extra?: string): string {
  return cx(BASE, VARIANT[variant], SQUARE[size], extra);
}

type Props = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and ignores clicks while keeping focus on the button. */
  loading?: boolean;
};

export function Button({ variant, size, className, type = 'button', loading = false, onClick, children, ...rest }: Props) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, cx(loading && 'cursor-progress', className))}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Spinner size={size === 'compact' ? 12 : 14} /> : null}
      {children}
    </button>
  );
}

type LinkProps = {
  href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode; download?: boolean; target?: string;
  /** Load the target as a new document: for a page that must start over even at the address it already has. */
  reload?: boolean;
};

export function ButtonLink({ href, variant, size, className, children, download, target, reload }: LinkProps) {
  const cls = buttonClass(variant, size, className);
  // Plain anchors for downloads, new tabs and document loads; router links otherwise.
  if (reload) return <a href={href} className={cls}>{children}</a>;
  if (download || target) return <a href={href} download={download} target={target} rel="noopener" className={cls}>{children}</a>;
  return <Link href={href} className={cls}>{children}</Link>;
}

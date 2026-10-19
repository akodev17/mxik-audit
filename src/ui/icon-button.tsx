import type { ComponentPropsWithRef, ReactNode } from 'react';
import { iconButtonClass, type ButtonSize } from './button';
import { Spinner } from './spinner';
import { Tooltip } from './tooltip';

type Props = Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> & {
  /** Required: it is the accessible name and the tooltip text. */
  label: string;
  icon: ReactNode;
  variant?: 'ghost' | 'secondary' | 'danger-ghost';
  size?: ButtonSize;
  tooltipSide?: 'top' | 'bottom';
  /** Keep the tooltip inside the viewport for buttons at a screen edge. */
  tooltipAlign?: 'start' | 'center' | 'end';
  loading?: boolean;
};

/** A button that shows only an icon; its label is announced and shown as a tooltip on hover and focus. */
export function IconButton({ label, icon, variant = 'ghost', size = 'sm', tooltipSide = 'top', tooltipAlign = 'center', loading = false, className, type = 'button', onClick, ...rest }: Props) {
  return (
    <Tooltip content={label} side={tooltipSide} align={tooltipAlign} describe={false}>
      <button
        type={type}
        aria-label={label}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        onClick={loading ? (e) => e.preventDefault() : onClick}
        className={iconButtonClass(variant, size, className)}
        {...rest}
      >
        {loading ? <Spinner size={14} /> : icon}
      </button>
    </Tooltip>
  );
}

'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button';
import { cx } from './cx';
import { focusables } from './focus';
import { IconChevronDown } from './icons';
import { useEscape, useOutsidePress } from './overlay';

type Props = {
  /** Text of the trigger button. */
  label: ReactNode;
  /** Accessible name of the panel; defaults to the trigger's text. */
  title?: string;
  /** Panel content; a function receives close() for a Done or Cancel button inside. */
  children: ReactNode | ((close: () => void) => ReactNode);
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  /** Controlled mode; omit both for the popover to keep its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  panelClassName?: string;
};

/**
 * A button that opens a small non-modal panel (filters, share settings). Focus moves into the panel;
 * Escape, a click outside or tabbing away closes it; Escape and close() return focus to the button.
 */
export function Popover({ label, title, children, icon, variant = 'secondary', size = 'md', align = 'start', side = 'bottom', open: controlled, onOpenChange, panelClassName }: Props) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const triggerId = useId();
  const panelId = useId();

  const setOpen = (next: boolean): void => {
    onOpenChange?.(next);
    if (controlled === undefined) setInner(next);
  };
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  useEscape(open, () => close(true));
  useOutsidePress(open, [root], () => close(false));

  useEffect(() => {
    if (!open || !panel.current) return;
    (focusables(panel.current)[0] ?? panel.current).focus({ preventScroll: true });
  }, [open]);

  const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
    if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) close(false);
  };

  return (
    <div ref={root} className="relative inline-block" onBlur={onBlur}>
      <button
        ref={trigger}
        id={triggerId}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={buttonClass(variant, size)}
      >
        {icon}
        {label}
        <IconChevronDown size={14} className={cx('transition-transform duration-(--duration-fast)', open && 'rotate-180')} />
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={title}
          aria-labelledby={title ? undefined : triggerId}
          tabIndex={-1}
          className={cx(
            'absolute z-dropdown w-max min-w-56 max-w-[min(24rem,calc(100vw-2rem))] rounded-md border border-line bg-raised p-3 text-data text-fg shadow-pop',
            'focus-visible:outline-none motion-safe:animate-pop-in',
            align === 'end' ? 'right-0' : 'left-0',
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
            panelClassName,
          )}
        >
          {typeof children === 'function' ? children(() => close(true)) : children}
        </div>
      ) : null}
    </div>
  );
}

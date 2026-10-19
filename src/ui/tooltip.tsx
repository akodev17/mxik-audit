'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from './cx';
import { useEscape } from './overlay';

type Side = 'top' | 'bottom';
type Align = 'start' | 'center' | 'end';
type TriggerProps = { 'aria-describedby'?: string };

type Props = {
  content: ReactNode;
  /** One focusable element: a button, link or input. */
  children: ReactElement<TriggerProps>;
  side?: Side;
  align?: Align;
  /** False when the trigger is already labelled by the same text (icon buttons): the tooltip is then visual only. */
  describe?: boolean;
};

// Padding, not margin, separates the bubble from the trigger, so the pointer can cross onto it.
const SIDE: Record<Side, string> = { top: 'bottom-full pb-1.5', bottom: 'top-full pt-1.5' };
const ALIGN: Record<Align, string> = { start: 'left-0', center: 'left-1/2 -translate-x-1/2', end: 'right-0' };
const HOVER_DELAY_MS = 300;

function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Short hint shown on hover and on keyboard focus; it stays while hovered and Escape hides it (WCAG 1.4.13). */
export function Tooltip({ content, children, side = 'top', align = 'center', describe = true }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const hide = (): void => {
    clear();
    setOpen(false);
  };
  const onPointerEnter = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    clear();
    timer.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  };
  const onFocus = (e: FocusEvent): void => {
    if (!focusVisible(e.target)) return;
    clear();
    setOpen(true);
  };

  useEffect(() => clear, []);
  useEscape(open, hide);

  const trigger = describe && isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': cx(children.props['aria-describedby'], id) })
    : children;

  return (
    <span className="relative inline-flex" onPointerEnter={onPointerEnter} onPointerLeave={hide} onFocus={onFocus} onBlur={hide}>
      {trigger}
      <span role="tooltip" id={id} hidden={!open} className={cx('absolute z-dropdown w-max max-w-64', SIDE[side], ALIGN[align])}>
        <span className="block rounded-sm bg-fg px-2 py-1 text-micro font-medium text-inverse shadow-pop motion-safe:animate-fade-in">
          {content}
        </span>
      </span>
    </span>
  );
}

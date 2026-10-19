'use client';

import { useEffect, useRef, useState, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../cx';
import { useEscape } from '../overlay';

type Props = {
  content: string;
  children: ReactNode;
  /** Classes of the wrapper, e.g. min-w-0 so a truncating trigger can shrink in a flex row. */
  className?: string;
};

const HOVER_DELAY_MS = 300;

function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * Tooltip below a header control, on hover and keyboard focus; Escape hides it, and it stays while
 * hovered. Unlike the shared Tooltip its wrapper takes classes, so the trigger may truncate.
 * Visual only: the trigger must already carry the same text in its accessible name.
 */
export function HoverTip({ content, children, className }: Props) {
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
    if (focusVisible(e.target)) setOpen(true);
  };

  useEffect(() => clear, []);
  useEscape(open, hide);

  return (
    <span className={cx('relative flex', className)} onPointerEnter={onPointerEnter} onPointerLeave={hide} onFocus={onFocus} onBlur={hide} onPointerDown={hide}>
      {children}
      <span aria-hidden hidden={!open} className="absolute left-0 top-full z-dropdown w-max max-w-[min(24rem,calc(100vw-2rem))] pt-1.5">
        <span className="block break-words rounded-sm bg-fg px-2 py-1 text-micro font-medium text-inverse shadow-pop motion-safe:animate-fade-in">{content}</span>
      </span>
    </span>
  );
}

'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';

type Props = {
  children: ReactNode;
  label?: string;
  stickyHeader?: boolean;
  maxHeight?: string;
  className?: string;
};

type Overflow = { left: boolean; right: boolean };

/**
 * Positioned, horizontally scrollable frame around a table. Fades at the edges show that more
 * columns sit off-screen; text hidden inside (sr-only) cannot widen the page.
 */
export function TableFrame({ children, label, stickyHeader = false, maxHeight, className }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>({ left: false, right: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = (): void => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  const scrollable = overflow.left || overflow.right;
  const style = stickyHeader ? ({ '--table-max-height': maxHeight ?? '70vh' } as CSSProperties) : undefined;
  const fade = 'pointer-events-none absolute inset-y-0 w-6 from-raised to-transparent transition-opacity duration-(--duration-fast)';
  return (
    <div className={cx('relative overflow-hidden rounded-ctl border border-line bg-raised', className)}>
      <div
        ref={scroller}
        role={label ? 'region' : undefined}
        aria-label={label}
        tabIndex={label && scrollable ? 0 : undefined}
        style={style}
        className={cx('relative overflow-x-auto focus-visible:outline-offset-[-2px]', stickyHeader && 'max-h-(--table-max-height) overflow-y-auto overscroll-contain')}
      >
        {children}
      </div>
      <span aria-hidden className={cx(fade, 'left-0 bg-linear-to-r', overflow.left ? 'opacity-100' : 'opacity-0')} />
      <span aria-hidden className={cx(fade, 'right-0 bg-linear-to-l', overflow.right ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}

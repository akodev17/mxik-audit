'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '@/ui/cx';

type Overflow = { left: boolean; right: boolean };

/**
 * Horizontal scroller for the settings tabs on narrow screens: the open tab is scrolled into view
 * on load, and edge fades show that more tabs sit off-screen.
 */
export function TabStrip({ label, children }: { label: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>({ left: false, right: false });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) el.scrollLeft = Math.max(0, active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2);
    const measure = (): void => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow((cur) => (cur.left === left && cur.right === right ? cur : { left, right }));
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  const fade = 'pointer-events-none absolute inset-y-0 w-8 from-base to-transparent transition-opacity duration-(--duration-fast)';
  return (
    <div className="relative -mx-4 sm:mx-0">
      <div ref={scroller} role="region" aria-label={label} className="relative overflow-x-auto px-4 sm:px-0 [&_a]:whitespace-nowrap">
        {children}
      </div>
      <span aria-hidden className={cx(fade, 'left-0 bg-linear-to-r', overflow.left ? 'opacity-100' : 'opacity-0')} />
      <span aria-hidden className={cx(fade, 'right-0 bg-linear-to-l', overflow.right ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}

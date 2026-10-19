'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { cx } from './cx';

export type TabItem = { href: string; label: string; active: boolean; count?: number };

type Overflow = { left: boolean; right: boolean };

/**
 * Link-based tabs: the active one is a URL, so it survives reloads. When the row is wider than the
 * screen it scrolls sideways (scrollbar hidden, edge fades show there is more) and the active tab
 * is scrolled into view.
 */
export function Tabs({ items }: { items: TabItem[] }) {
  const scroller = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState<Overflow>({ left: false, right: false });
  const activeHref = items.find((i) => i.active)?.href;

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
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    const tab = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !tab) return;
    // Centre it by moving the row only; scrollIntoView could also scroll the page.
    const target = tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2;
    el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
  }, [activeHref]);

  const fade = 'pointer-events-none absolute inset-y-0 w-6 from-base to-transparent transition-opacity duration-(--duration-fast)';
  return (
    <div className="relative">
      {/* The baseline is an inset shadow, so the active underline covers it without overflowing the scroller. */}
      <nav
        ref={scroller}
        className="relative flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            aria-current={i.active ? 'page' : undefined}
            className={cx(
              'shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-offset-[-2px]',
              i.active ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {i.label}
            {i.count !== undefined ? <span className="ml-1.5 text-xs text-muted">{i.count}</span> : null}
          </Link>
        ))}
      </nav>
      <span aria-hidden className={cx(fade, 'left-0 bg-linear-to-r', overflow.left ? 'opacity-100' : 'opacity-0')} />
      <span aria-hidden className={cx(fade, 'right-0 bg-linear-to-l', overflow.right ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}

'use client';

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import { cx } from '@/ui/cx';

export type SectionKey = 'details' | 'evidence' | 'comments' | 'history';

export const sectionId = (findingId: string, key: SectionKey): string => `ws-drawer-${key}-${findingId}`;

type Item = { key: SectionKey; label: string; count?: number };

/**
 * The drawer's section bar: tab-like buttons that scroll to Details, Evidence, Comments and History
 * (every section stays in the page, so nothing is hidden from search, print or a screen reader), and
 * mark the one being read. Sticks to the top of the drawer's scroll area.
 */
export function SectionNav({ findingId, items, root }: { findingId: string; items: Item[]; root: RefObject<HTMLElement | null> }) {
  const { ta } = useI18n();
  const [current, setCurrent] = useState<SectionKey>(items[0]?.key ?? 'details');

  useEffect(() => {
    const scroller = root.current?.closest('.overflow-y-auto') ?? null;
    if (!scroller || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<SectionKey, boolean>();
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.getAttribute('data-section') as SectionKey, e.isIntersecting);
      const first = items.find((i) => seen.get(i.key));
      if (first) setCurrent(first.key);
    }, { root: scroller, rootMargin: '-48px 0px -55% 0px' });
    for (const i of items) {
      const el = document.getElementById(sectionId(findingId, i.key));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [findingId, items, root]);

  const go = (key: SectionKey): void => {
    setCurrent(key);
    document.getElementById(sectionId(findingId, key))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <nav aria-label={ta.wsUi.drawer.sections} className="sticky -top-4 z-sticky -mx-5 mb-4 border-b border-line bg-raised px-5">
      <div className="flex gap-1 overflow-x-auto">
        {items.map((i) => (
          <button
            key={i.key} type="button" onClick={() => go(i.key)} aria-current={current === i.key ? 'true' : undefined}
            className={cx(
              'relative inline-flex h-10 shrink-0 items-center gap-1.5 px-2 text-small font-medium transition-colors duration-(--duration-fast)',
              current === i.key ? 'text-fg after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand' : 'text-muted hover:text-fg',
            )}
          >
            {i.label}
            {i.count ? <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-sunken px-1 text-micro tabular-nums text-muted">{i.count}</span> : null}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** One drawer section: an anchor for the section bar and an h3 title. */
export function DrawerSection({ findingId, section, title, children, className }: { findingId: string; section: SectionKey; title: string; children: ReactNode; className?: string }) {
  return (
    <section id={sectionId(findingId, section)} data-section={section} className={cx('scroll-mt-12 space-y-4', className)} aria-label={title}>
      <h3 className="text-micro font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

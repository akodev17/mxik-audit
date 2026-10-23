'use client';

import { useEffect, useState } from 'react';
import { cx } from '@/ui/cx';

export type NavGroup = { title: string; items: { id: string; label: string; method?: string }[] };

const METHOD: Record<string, string> = { GET: 'bg-info-tint text-info-ink', POST: 'bg-good-tint text-good-ink' };

/** The method of an endpoint as a small mono tag. */
export function MethodTag({ method, className }: { method: string; className?: string }) {
  return <span className={cx('inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 font-mono text-[11px] font-semibold', METHOD[method] ?? 'bg-sunken text-muted', className)}>{method}</span>;
}

/**
 * The docs' table of contents in groups. While the page scrolls, the section in view is marked
 * (aria-current="location"); the address is never rewritten, so links and history stay plain anchors.
 */
export function DocsNav({ label, groups }: { label: string; groups: NavGroup[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    const targets = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    // The section whose top crossed the upper third of the screen last is the one being read.
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '0px 0px -66% 0px' });
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [groups]);

  return (
    <nav aria-label={label} className="space-y-5 text-small">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-2 text-micro font-semibold uppercase tracking-wide text-subtle">{g.title}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const current = active === i.id;
              return (
                <li key={i.id}>
                  <a
                    href={`#${i.id}`}
                    aria-current={current ? 'location' : undefined}
                    className={cx(
                      'flex min-h-8 items-center gap-2 rounded-md px-2 py-1 transition-colors duration-(--duration-fast)',
                      current ? 'bg-brand-tint font-medium text-brand-ink' : 'text-muted hover:bg-surface hover:text-fg',
                    )}
                  >
                    {i.method ? <MethodTag method={i.method} /> : null}
                    <span className="min-w-0">{i.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

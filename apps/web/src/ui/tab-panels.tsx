'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export type TabPanel = { id: string; label: string; content: ReactNode };

/**
 * In-page tabs: switch between panels without leaving the page. Every panel is rendered (the content
 * is already on the page); only the selected one is shown. Arrow keys, Home and End move the
 * selection, as the tab pattern expects.
 */
export function TabPanels({ tabs, label, className }: { tabs: readonly TabPanel[]; label: string; className?: string }) {
  const [current, setCurrent] = useState(tabs[0]?.id ?? '');
  const base = useId();
  const list = useRef<HTMLDivElement>(null);

  const move = (to: number): void => {
    const next = tabs[(to + tabs.length) % tabs.length];
    if (!next) return;
    setCurrent(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const at = tabs.findIndex((t) => t.id === current);
    if (e.key === 'ArrowRight') { e.preventDefault(); move(at + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(tabs.length - 1); }
  };

  return (
    <div className={className}>
      <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button
            key={t.id} type="button" role="tab" id={`${base}-${t.id}`} data-tab={t.id}
            aria-selected={current === t.id} aria-controls={`${base}-${t.id}-panel`} tabIndex={current === t.id ? 0 : -1}
            onClick={() => setCurrent(t.id)}
            className={cx(
              'rounded-ctl px-3 py-1.5 text-data font-medium transition-colors duration-(--duration-fast)',
              current === t.id ? 'bg-surface text-fg' : 'text-muted hover:bg-surface/70 hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-${t.id}-panel`} aria-labelledby={`${base}-${t.id}`} hidden={current !== t.id} className="mt-4">
          {t.content}
        </div>
      ))}
    </div>
  );
}

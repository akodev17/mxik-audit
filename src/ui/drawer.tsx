'use client';

import { useEffect, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode };

/** Right-side panel; the page behind stays visible and interactive. */
export function Drawer({ open, title, onClose, children, footer }: Props) {
  const { ta } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <aside
      role="complementary"
      aria-label={title}
      className="no-print fixed bottom-0 right-0 top-14 z-30 flex w-full max-w-[460px] flex-col border-l border-line bg-base shadow-pop"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="truncate text-base">{title}</h2>
        <button type="button" onClick={onClose} aria-label={ta.shell.close} className="grid size-8 place-items-center rounded-ctl text-muted hover:bg-surface hover:text-fg">✕</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? <footer className="border-t border-line bg-surface px-5 py-3">{footer}</footer> : null}
    </aside>
  );
}

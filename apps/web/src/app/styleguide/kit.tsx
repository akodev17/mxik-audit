'use client';

import { useState, type ReactNode } from 'react';
import { cx } from '@/ui/cx';
import { IconCheck, IconCopy } from '@/ui/icons';

/** One guide section: anchored, titled, with a one-line purpose. */
export function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border-t border-line py-10 first:border-t-0 first:pt-0">
      <h2 id={`${id}-title`} className="text-title">{title}</h2>
      {hint ? <p className="mt-1 max-w-3xl text-small text-muted">{hint}</p> : null}
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  );
}

/** A labelled sub-area inside a section. */
export function Sub({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-section">{title}</h3>
        {note ? <p className="text-small text-muted">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

/** One row of variants: a label on the left, the examples on the right. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-3 last:border-b-0 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
      <span className="font-mono text-mono text-muted">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A framed example surface, so a component is judged on the page background it will sit on. */
export function Stage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-ctl border border-line bg-base p-4 sm:p-5', className)}>{children}</div>;
}

/** Marks a pattern that exists in the application but is not a shared component yet. */
export function PatternNote({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-micro text-muted"><span className="mr-1.5 rounded-sm bg-sunken px-1.5 py-0.5 font-medium text-fg">pattern</span>{children}</p>;
}

/** Copies text and says so for a moment; safe where the clipboard is blocked. */
export function CopyText({ text, children, className }: { text: string; children: ReactNode; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    }).catch(() => undefined);
  };
  return (
    <button
      type="button" onClick={copy} title={`Copy ${text}`}
      className={cx('group inline-flex max-w-full items-center gap-1.5 rounded-sm text-left transition-colors hover:text-brand-ink', className)}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span aria-hidden className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
      </span>
      <span aria-live="polite" className="sr-only">{done ? 'Copied' : ''}</span>
    </button>
  );
}

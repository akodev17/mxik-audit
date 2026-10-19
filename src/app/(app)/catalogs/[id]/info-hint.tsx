'use client';

import { useId, useState } from 'react';
import { IconInfo } from '@/ui/icons';

/**
 * An "i" button that shows a short explanation on click or tap, for touch,
 * keyboard and screen-reader users alike (a title attribute reaches none of
 * them). Escape or leaving the button hides it.
 */
export function InfoHint({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex items-center">
      <button
        type="button" aria-label={label} aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
        className="grid size-6 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg"
      >
        <IconInfo size={14} />
      </button>
      <span
        id={id} role="note" hidden={!open}
        className="absolute left-0 top-full z-dropdown mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-raised p-2 text-micro font-normal text-fg shadow-pop"
      >
        {text}
      </span>
    </span>
  );
}

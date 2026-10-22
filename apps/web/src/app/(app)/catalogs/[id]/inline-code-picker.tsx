'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { lookupCodes, type ClassifierHit } from '@/app/actions/review';
import { useI18n } from '@/lib/locale-client';
import { CodeChip } from '@/ui/code-chip';
import { Portal } from '@/ui/portal';
import { Spinner } from '@/ui/spinner';

type Props = { onPick: (code: string, name: string) => void; onCancel: () => void };
type Box = { left: number; top: number; width: number };

/**
 * Classifier search inside a grid cell (a combobox). The list is portalled
 * and fixed-positioned, so the grid's scroll frame never clips it. Arrows and
 * Enter pick, Escape closes.
 */
export function InlineCodePicker({ onPick, onCancel }: Props) {
  const { ta } = useI18n();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClassifierHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); setFailed(false); return; }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      lookupCodes(query)
        .then((h) => { if (live) { setHits(h); setCursor(0); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); })
        .finally(() => { if (live) setBusy(false); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  useLayoutEffect(() => {
    const place = (): void => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(440, window.innerWidth - 16);
      setBox({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 4, width });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, []);

  function onKey(e: React.KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const hit = hits[cursor]; if (hit) onPick(hit.code, hit.name); }
  }

  const open = hits.length > 0 || failed || (query.trim().length >= 2 && !busy);
  const optionId = (i: number): string => `${listId}-${i}`;
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} onBlur={() => setTimeout(onCancel, 150)}
        placeholder={ta.drawer.searchPlaceholder} aria-label={ta.drawer.search}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={hits.length > 0 ? optionId(cursor) : undefined}
        className="h-control-inline w-full rounded-ctl border border-brand bg-raised px-2 text-small text-fg focus-visible:outline-2 focus-visible:outline-focus"
      />
      {busy ? <Spinner size={12} className="absolute right-2 top-2 text-muted" /> : null}
      {open && box ? (
        <Portal>
          <ul
            id={listId} role="listbox" aria-label={ta.drawer.search}
            style={{ left: box.left, top: box.top, width: box.width }}
            className="fixed z-dropdown max-h-72 overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-pop"
          >
            {failed ? <li role="presentation" className="px-3 py-2 text-small text-danger-ink">{ta.wsX.toast.network}</li> : null}
            {!failed && hits.length === 0 ? <li role="presentation" className="px-3 py-2 text-small text-muted">{ta.drawer.searchEmpty}</li> : null}
            {hits.map((h, i) => (
              <li
                key={h.code} id={optionId(i)} role="option" aria-selected={i === cursor}
                onMouseDown={(e) => { e.preventDefault(); onPick(h.code, h.name); }}
                onMouseEnter={() => setCursor(i)}
                className={`cursor-pointer px-3 py-1.5 ${i === cursor ? 'bg-brand-tint' : 'hover:bg-surface'}`}
              >
                <CodeChip code={h.code} />
                <span className="mt-0.5 block truncate text-small text-fg" title={h.name}>{h.name}</span>
                {h.path ? <span className="block truncate text-micro text-muted" title={h.path}>{h.path}</span> : null}
              </li>
            ))}
          </ul>
        </Portal>
      ) : null}
    </div>
  );
}

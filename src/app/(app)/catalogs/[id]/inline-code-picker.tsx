'use client';

import { useEffect, useRef, useState } from 'react';
import { lookupCodes, type ClassifierHit } from '@/app/actions/review';
import { ta } from '@/lib/i18n-app';
import { CodeChip } from '@/ui/code-chip';

type Props = { onPick: (code: string, name: string) => void; onCancel: () => void };

/** Search the classifier inside the grid cell; arrows and Enter pick, Escape closes. */
export function InlineCodePicker({ onPick, onCancel }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClassifierHit[]>([]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (query.trim().length < 2) { setHits([]); return; }
    let live = true;
    const timer = setTimeout(() => { void lookupCodes(query).then((h) => { if (live) { setHits(h); setCursor(0); } }); }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  function onKey(e: React.KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === 'Escape') onCancel();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const hit = hits[cursor]; if (hit) onPick(hit.code, hit.name); }
  }

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} onBlur={() => setTimeout(onCancel, 150)}
        placeholder={ta.drawer.searchPlaceholder} aria-label={ta.drawer.search}
        className="h-8 w-full rounded-ctl border border-brand bg-base px-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      {hits.length > 0 ? (
        <ul role="listbox" className="absolute left-0 top-9 z-30 max-h-72 w-[420px] overflow-y-auto rounded-ctl border border-line bg-base py-1 shadow-pop">
          {hits.map((h, i) => (
            <li key={h.code} role="option" aria-selected={i === cursor}>
              <button
                type="button" onMouseDown={(e) => { e.preventDefault(); onPick(h.code, h.name); }}
                className={`block w-full px-3 py-1.5 text-left ${i === cursor ? 'bg-brand-tint' : 'hover:bg-surface'}`}
              >
                <CodeChip code={h.code} />
                <span className="mt-0.5 block truncate text-sm" title={h.name}>{h.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

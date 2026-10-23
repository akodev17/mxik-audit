'use client';

import { forwardRef, useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useI18n } from '@/lib/locale-client';
import { CodeChip } from '@/ui/code-chip';
import { cx } from '@/ui/cx';
import { IconSearch } from '@/ui/icons';
import { Input } from '@/ui/input';
import { Kbd } from '@/ui/kbd';
import { Spinner } from '@/ui/spinner';
import { useCodeLookup } from './code-lookup';
import { count } from './ws-text';

type Props = { disabled: boolean; onPick: (code: string, name: string) => void };

/**
 * Search the whole classifier and pick any code: a combobox over a list of hits (names and paths in
 * the viewer's language). Arrows move through the list, Enter picks the marked hit, a click picks any.
 */
export const CodeSearch = forwardRef<HTMLInputElement, Props>(function CodeSearch({ disabled, onPick }, ref) {
  const { ta, locale } = useI18n();
  const u = ta.wsUi.drawer;
  const [query, setQuery] = useState('');
  const { hits, busy, failed } = useCodeLookup(query, 250);
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const optionId = (i: number): string => `${listId}-${i}`;
  const list = hits ?? [];

  // New hits start at the top.
  useEffect(() => { setCursor(0); }, [hits]);

  const pick = (i: number): void => {
    const hit = list[i];
    if (hit && !disabled) onPick(hit.code, hit.name);
  };

  function onKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (list.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(list.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cursor); }
  }

  // The marked hit stays in view while the arrows move through a long list.
  useEffect(() => {
    if (cursor > 0) document.getElementById(`${listId}-${cursor}`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor, listId]);

  return (
    <div>
      <div className="relative">
        <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
          placeholder={ta.drawer.searchPlaceholder} aria-label={ta.drawer.search} className="pl-9 pr-9"
          role="combobox" aria-expanded={list.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={list.length > 0 ? optionId(cursor) : undefined}
        />
        {busy ? <Spinner size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" /> : null}
      </div>
      {failed ? <p role="alert" className="mt-2 text-small text-danger-ink">{ta.wsX.toast.network}</p> : null}
      {hits && hits.length === 0 && !failed ? <p className="mt-2 text-small text-muted">{ta.drawer.searchEmpty}</p> : null}
      {list.length > 0 ? (
        <>
          <p className="mt-2 flex items-center justify-between gap-2 text-micro text-muted">
            <span>{count(locale, u.results, list.length)}</span>
            <span>{u.pickHint}</span>
          </p>
          <ul id={listId} role="listbox" aria-label={ta.drawer.search} className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-line py-1">
            {list.map((h, i) => (
              <li
                key={h.code} id={optionId(i)} role="option" aria-selected={i === cursor} aria-disabled={disabled || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                onMouseEnter={() => setCursor(i)}
                className={cx('flex cursor-pointer items-center gap-3 px-3 py-2', i === cursor ? 'bg-brand-tint' : 'hover:bg-surface', disabled && 'cursor-not-allowed opacity-60')}
              >
                <span className="min-w-0 flex-1">
                  <CodeChip code={h.code} />
                  <span className="mt-0.5 block truncate text-small text-fg" title={h.name}>{h.name}</span>
                  {h.path ? <span className="block truncate text-micro text-muted" title={h.path}>{h.path}</span> : null}
                </span>
                {i === cursor ? <Kbd className="shrink-0">Enter</Kbd> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
});

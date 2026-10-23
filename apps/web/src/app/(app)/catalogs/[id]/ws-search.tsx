'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useI18n } from '@/lib/locale-client';
import { IconButton } from '@/ui/icon-button';
import { IconSearch, IconX } from '@/ui/icons';
import { Input } from '@/ui/input';
import { useFilterNav } from './filter-controls';

const DEBOUNCE_MS = 350;
const MAX = 100;

// A new search remounts the workspace (its rows come from the server), and this
// field with it. What the user was typing, and that they were, survives here.
const carry = { focused: false, text: null as string | null };

/** Search within the open catalogue (name, code or barcode), bound to ?q after a short pause in typing. */
export function WsSearch({ value, inputRef }: { value: string; inputRef: RefObject<HTMLInputElement | null> }) {
  const { ta } = useI18n();
  const f = ta.wsX.filter;
  const go = useFilterNav();
  const [text, setText] = useState(value);
  const local = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (carry.text !== null && carry.text.trim() !== value) setText(carry.text);
    if (carry.focused) {
      const el = local.current;
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(el.value.length, el.value.length);
    }
    carry.text = null;
  }, [value]);
  // Leaving the workspace (focus went elsewhere first) forgets an unsent search.
  useEffect(() => () => { if (!carry.focused) carry.text = null; }, []);

  const push = (raw: string): void => {
    const q = raw.trim().slice(0, MAX);
    if (q === value) return;
    go((p) => { if (q) p.set('q', q); else p.delete('q'); p.delete('row'); });
  };

  useEffect(() => {
    if (text.trim() === value) return;
    const timer = setTimeout(() => push(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  return (
    <form role="search" className="relative w-full md:w-56" onSubmit={(e) => { e.preventDefault(); push(text); }}>
      <IconSearch size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
      <Input
        ref={(el) => { local.current = el; inputRef.current = el; }}
        type="search" size="compact" value={text} maxLength={MAX}
        placeholder={f.searchPlaceholder} aria-label={f.searchLabel} className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => { setText(e.target.value); carry.text = e.target.value; }}
        onFocus={() => { carry.focused = true; }}
        onBlur={(e) => { if (e.currentTarget.isConnected) carry.focused = false; }}
        onKeyDown={(e) => { if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); carry.text = ''; } }}
      />
      {text ? (
        <span className="absolute right-1 top-1/2 -translate-y-1/2">
          <IconButton size="compact" label={f.clearSearch} icon={<IconX size={14} />} onClick={() => { setText(''); carry.text = ''; push(''); }} />
        </span>
      ) : null}
    </form>
  );
}

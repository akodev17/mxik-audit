'use client';

import { useEffect, useState } from 'react';
import { lookupCodes, type ClassifierHit } from '@/app/actions/review';
import { ta } from '@/lib/i18n-app';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { Input } from '@/ui/input';

type Props = { disabled: boolean; onPick: (code: string, name: string) => void };

/** Search the whole classifier and pick any code. */
export function CodeSearch({ disabled, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClassifierHit[] | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); return; }
    let live = true;
    const timer = setTimeout(() => { void lookupCodes(query).then((h) => { if (live) setHits(h); }); }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  return (
    <div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ta.drawer.searchPlaceholder} aria-label={ta.drawer.search} />
      {hits && hits.length === 0 ? <p className="mt-2 text-sm text-muted">{ta.drawer.searchEmpty}</p> : null}
      {hits && hits.length > 0 ? (
        <ul className="mt-2 divide-y divide-line rounded-ctl border border-line">
          {hits.map((h) => (
            <li key={h.code} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <CodeChip code={h.code} />
                <span className="mt-0.5 block truncate text-sm" title={h.name}>{h.name}</span>
                {h.path ? <span className="block truncate text-xs text-muted" title={h.path}>{h.path}</span> : null}
              </span>
              <Button size="sm" disabled={disabled} onClick={() => onPick(h.code, h.name)}>{ta.drawer.choose}</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

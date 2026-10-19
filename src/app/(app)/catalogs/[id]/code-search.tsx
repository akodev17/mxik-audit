'use client';

import { forwardRef, useEffect, useState } from 'react';
import { lookupCodes, type ClassifierHit } from '@/app/actions/review';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';
import { Input } from '@/ui/input';
import { Spinner } from '@/ui/spinner';

type Props = { disabled: boolean; onPick: (code: string, name: string) => void };

/** Search the whole classifier and pick any code; names and paths in the viewer's language. */
export const CodeSearch = forwardRef<HTMLInputElement, Props>(function CodeSearch({ disabled, onPick }, ref) {
  const { ta } = useI18n();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClassifierHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) { setHits(null); setFailed(false); return; }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      lookupCodes(query)
        .then((h) => { if (live) { setHits(h); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); })
        .finally(() => { if (live) setBusy(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  return (
    <div>
      <div className="relative">
        <Input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={ta.drawer.searchPlaceholder} aria-label={ta.drawer.search} />
        {busy ? <Spinner size={14} className="absolute right-3 top-3 text-muted" /> : null}
      </div>
      {failed ? <p role="alert" className="mt-2 text-small text-danger-ink">{ta.wsX.toast.network}</p> : null}
      {hits && hits.length === 0 && !failed ? <p className="mt-2 text-small text-muted">{ta.drawer.searchEmpty}</p> : null}
      {hits && hits.length > 0 ? (
        <ul className="mt-2 divide-y divide-line rounded-ctl border border-line">
          {hits.map((h) => (
            <li key={h.code} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <CodeChip code={h.code} />
                <span className="mt-0.5 block truncate text-small text-fg" title={h.name}>{h.name}</span>
                {h.path ? <span className="block truncate text-micro text-muted" title={h.path}>{h.path}</span> : null}
              </span>
              <Button size="sm" disabled={disabled} onClick={() => onPick(h.code, h.name)} aria-label={`${ta.wsX.drawer.choose}: ${h.code}`}>{ta.drawer.choose}</Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});

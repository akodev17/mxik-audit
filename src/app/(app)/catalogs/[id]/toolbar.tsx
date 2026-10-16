'use client';

import { useI18n } from '@/lib/locale-client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';

type Props = {
  count: number;
  compact: boolean;
  grouped: boolean;
  pendingOnly: boolean;
  query: string;
  commented: boolean;
  busy: boolean;
  onCompact: (v: boolean) => void;
  onGrouped: (v: boolean) => void;
  onAcceptSure: () => void;
  readOnly: boolean;
  dictionaryPending: number;
  onAcceptDictionary: () => void;
};

function Segment({ options, value, onChange, label }: { options: [string, string][]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-ctl border border-line-strong p-0.5">
      {options.map(([key, text]) => (
        <button
          key={key} type="button" aria-pressed={value === key} onClick={() => onChange(key)}
          className={cx('h-7 rounded-[6px] px-2.5 text-sm font-medium', value === key ? 'bg-fg text-white' : 'text-muted hover:text-fg')}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Density, grouping, review scope and bulk accept for the grid below. */
export function Toolbar({ count, compact, grouped, pendingOnly, query, commented, busy, onCompact, onGrouped, onAcceptSure, readOnly, dictionaryPending, onAcceptDictionary }: Props) {
  const { ta } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (mutate: (p: URLSearchParams) => void): void => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div className="no-print flex flex-wrap items-center gap-3 border-b border-line px-5 py-2">
      <span className="text-sm text-muted">{ta.ws.rowCount(count)}</span>
      {query ? (
        <button type="button" onClick={() => go((p) => p.delete('q'))} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-tint px-3 text-sm text-brand" title={ta.ws.clearSearch}>
          {ta.ws.searchActive(query)} <span aria-hidden>✕</span>
        </button>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" checked={pendingOnly} className="size-4 accent-[var(--color-brand)]"
          onChange={(e) => go((p) => { if (e.target.checked) p.delete('pending'); else p.set('pending', '0'); })}
        />
        {ta.ws.onlyUnreviewed}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox" checked={commented} className="size-4 accent-[var(--color-brand)]"
          onChange={(e) => go((p) => { if (e.target.checked) p.set('comments', '1'); else p.delete('comments'); })}
        />
        {ta.comments.onlyCommented}
      </label>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {readOnly || dictionaryPending === 0 ? null : <Button size="sm" variant="secondary" disabled={busy} onClick={onAcceptDictionary}>{ta.dict.acceptAll(dictionaryPending)}</Button>}
        {readOnly ? null : <Button size="sm" variant="secondary" disabled={busy} onClick={onAcceptSure}>{ta.ws.acceptAll}</Button>}
        <Segment label={ta.ws.grouped} value={grouped ? 'g' : 'f'} onChange={(v) => onGrouped(v === 'g')} options={[['f', ta.ws.flat], ['g', ta.ws.grouped]]} />
        <Segment label={ta.ws.density} value={compact ? 'c' : 'k'} onChange={(v) => onCompact(v === 'c')} options={[['k', ta.ws.comfortable], ['c', ta.ws.compact]]} />
      </div>
    </div>
  );
}

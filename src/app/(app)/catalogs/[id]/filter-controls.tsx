'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { useI18n } from '@/lib/locale-client';
import { DECISION_FILTERS, FLAG_FILTERS, type WsFilter } from '@/lib/workspace-filter';
import { Checkbox } from '@/ui/checkbox';
import { cx } from '@/ui/cx';
import { Select } from '@/ui/select';

/** Replaces the workspace URL's query; `v=0` keeps the default view from being applied again. */
export function useFilterNav(): (mutate: (p: URLSearchParams) => void) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return useCallback((mutate) => {
    const next = new URLSearchParams(params.toString());
    // The older "pending=0" spelling becomes "dec=all" before anything else changes.
    if (next.get('pending') === '0' && !next.has('dec')) next.set('dec', 'all');
    next.delete('pending');
    mutate(next);
    next.set('v', '0');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [params, pathname, router]);
}

/** How many filters differ from the default view (for the phone's "Filters (n)" button). */
export const activeFilters = (f: WsFilter): number =>
  [f.decision !== 'pending', f.flag !== 'any', f.commented, f.sort !== 'risk'].filter(Boolean).length;

/** Decision, flag, sort and "commented only"; inline on desktop, stacked in a sheet on phones. */
export function FilterControls({ filter, stacked }: { filter: WsFilter; stacked: boolean }) {
  const { ta } = useI18n();
  const f = ta.wsX.filter;
  const go = useFilterNav();
  const set = (key: string, value: string, fallback: string): void => go((p) => { if (value === fallback) p.delete(key); else p.set(key, value); });
  // Stacked (phone sheet): label above. Inline (toolbar): label beside, to keep the toolbar one line high.
  const field = (label: string, control: React.ReactNode) => (
    <label className={cx('flex text-small text-muted', stacked ? 'flex-col gap-1' : 'items-center gap-1.5')}>
      <span className={stacked ? 'font-medium text-fg' : undefined}>{label}</span>
      {control}
    </label>
  );
  return (
    <div className={stacked ? 'flex flex-col gap-3' : 'contents'}>
      {field(f.decision, (
        <Select size="compact" value={filter.decision} onChange={(e) => set('dec', e.target.value, 'pending')}>
          {DECISION_FILTERS.map((d) => <option key={d} value={d}>{f.decisionOpt[d]}</option>)}
        </Select>
      ))}
      {field(f.flag, (
        <Select size="compact" value={filter.flag} onChange={(e) => set('flag', e.target.value, 'any')}>
          {FLAG_FILTERS.map((d) => <option key={d} value={d}>{f.flagOpt[d]}</option>)}
        </Select>
      ))}
      {field(f.sort, (
        <Select size="compact" value={filter.sort} onChange={(e) => set('sort', e.target.value, 'risk')}>
          <option value="risk">{f.sortOpt.risk}</option>
          <option value="row">{f.sortOpt.row}</option>
        </Select>
      ))}
      <Checkbox
        label={f.commented} checked={filter.commented}
        onChange={(e) => go((p) => { if (e.target.checked) p.set('comments', '1'); else p.delete('comments'); })}
      />
    </div>
  );
}

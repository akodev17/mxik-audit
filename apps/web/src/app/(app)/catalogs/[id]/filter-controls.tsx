'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { useI18n } from '@/lib/locale-client';
import { DECISION_FILTERS, FLAG_FILTERS, type WsFilter } from '@/lib/workspace-url';
import { Checkbox } from '@/ui/checkbox';
import { cx } from '@/ui/cx';
import { Select } from '@/ui/select';
import { goTo } from '@/ui/shell/same-route-links';

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
    goTo(`${pathname}?${next.toString()}`, (href) => router.replace(href, { scroll: false }));
  }, [params, pathname, router]);
}

export type FilterField = 'decision' | 'flag' | 'sort' | 'commented';
const ALL_FIELDS: readonly FilterField[] = ['decision', 'flag', 'sort', 'commented'];

/** How many of these filters differ from the default view (for a "Filters (n)" button). */
export const activeFilters = (f: WsFilter, fields: readonly FilterField[] = ALL_FIELDS): number => {
  const changed: Record<FilterField, boolean> = { decision: f.decision !== 'pending', flag: f.flag !== 'any', sort: f.sort !== 'risk', commented: f.commented };
  return fields.filter((k) => changed[k]).length;
};

/** Decision, flag, sort and "commented only", or some of them; inline in the toolbar, stacked in a panel. */
export function FilterControls({ filter, stacked, fields = ALL_FIELDS }: { filter: WsFilter; stacked: boolean; fields?: readonly FilterField[] }) {
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
  const on = new Set(fields);
  return (
    <div className={stacked ? 'flex flex-col gap-3' : 'contents'}>
      {on.has('decision') ? field(f.decision, (
        <Select size="compact" value={filter.decision} onChange={(e) => set('dec', e.target.value, 'pending')}>
          {DECISION_FILTERS.map((d) => <option key={d} value={d}>{f.decisionOpt[d]}</option>)}
        </Select>
      )) : null}
      {on.has('flag') ? field(f.flag, (
        <Select size="compact" value={filter.flag} onChange={(e) => set('flag', e.target.value, 'any')}>
          {FLAG_FILTERS.map((d) => <option key={d} value={d}>{f.flagOpt[d]}</option>)}
        </Select>
      )) : null}
      {on.has('sort') ? field(f.sort, (
        <Select size="compact" value={filter.sort} onChange={(e) => set('sort', e.target.value, 'risk')}>
          <option value="risk">{f.sortOpt.risk}</option>
          <option value="row">{f.sortOpt.row}</option>
        </Select>
      )) : null}
      {on.has('commented') ? (
        <Checkbox
          label={f.commented} checked={filter.commented}
          onChange={(e) => go((p) => { if (e.target.checked) p.set('comments', '1'); else p.delete('comments'); })}
        />
      ) : null}
    </div>
  );
}

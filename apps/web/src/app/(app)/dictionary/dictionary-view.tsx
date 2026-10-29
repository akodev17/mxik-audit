'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/empty-state';
import { IconBook, IconSearch } from '@/ui/icons';
import { DICT_FILTERS, type DictFilter } from './dictionary-params';
import { DictionaryTable, type DictRow } from './dictionary-table';

export type DictionaryList = ResponseOf<typeof endpoints.dictionary.list>;

/** Every dictionary listing in the cache; an edit or delete refetches the one on screen. */
export const DICTIONARY = ['dictionary'] as const;

type Props = { q: string; filter: DictFilter; page: number; initial: DictionaryList; editable: boolean; admin: boolean };

/** Filter chips with counts, the entries and the pager; the page read the first copy, edits refetch it. */
export function DictionaryView({ q, filter, page, initial, editable, admin }: Props) {
  const { ta, locale } = useI18n();
  const x = ta.wsX.dict;
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: [...DICTIONARY, { q, filter, page }],
    queryFn: ({ signal }) => api.dictionary.list({ ...(q ? { q } : {}), ...(filter !== 'all' ? { f: filter } : {}), page }, { signal }),
    initialData: initial, staleTime: Infinity, gcTime: 0,
  });
  // A new server render of the same URL brings a fresh copy.
  useEffect(() => { queryClient.setQueryData([...DICTIONARY, { q, filter, page }], initial); }, [queryClient, q, filter, page, initial]);
  const { counts, total, pageSize } = data;
  const rows: DictRow[] = data.rows.map(({ updatedAt, disputedAt, ...e }) => ({ ...e, updated: fmtDate(locale, updatedAt), disputed: disputedAt ? fmtDate(locale, disputedAt) : null }));
  const params = (over: { p?: number; f?: DictFilter }): string => {
    const f = over.f ?? filter;
    return `/dictionary?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== 'all' ? { f } : {}), page: String(over.p ?? 0) })}`;
  };
  const href = (p: number): string => params({ p });

  return (
    <>
      {counts.all > 0 ? (
        <nav aria-label={x.filterLabel} className="mb-3 flex flex-wrap items-center gap-2">
          {DICT_FILTERS.filter((f) => f === 'all' || f === filter || counts[f] > 0).map((f) => {
            const on = f === filter;
            return (
              <Link
                key={f} href={params({ f })} aria-current={on ? 'true' : undefined}
                className={cx(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border pl-3 pr-1.5 text-small font-medium transition-colors duration-(--duration-fast)',
                  on ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface',
                )}
              >
                {x.filters[f]}
                <span className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-micro tabular-nums', on ? 'bg-raised text-brand-ink' : 'bg-sunken text-muted')}>{fmtNumber(locale, counts[f])}</span>
              </Link>
            );
          })}
        </nav>
      ) : null}
      {filter === 'unverified' || filter === 'reconfirm' || filter === 'stale' ? <p className="mb-3 text-small text-muted">{x.filterHints[filter]}</p> : null}
      {rows.length === 0 ? (
        q || filter !== 'all'
          ? <EmptyState icon={<IconSearch size={20} />} title={x.emptySearch} hint={x.emptySearchHint} action={<ButtonLink size="sm" variant="secondary" href="/dictionary">{ta.wsX.filter.reset}</ButtonLink>} />
          : <EmptyState icon={<IconBook size={20} />} title={x.emptyTitle} hint={x.emptyHint} />
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-section">{x.total(fmtNumber(locale, total), total)}</h2>
            {editable ? (admin ? null : <p className="text-small text-muted">{x.adminOnlyHint}</p>) : <p className="text-small text-muted">{x.viewerHint}</p>}
          </div>
          <DictionaryTable rows={rows} canConfirm={editable} admin={admin} />
          {page > 0 || (page + 1) * pageSize < total ? (
            <nav aria-label={x.pages} className="mt-3 flex flex-wrap items-center justify-end gap-2">
              {page > 0 ? <ButtonLink size="sm" variant="ghost" href={href(page - 1)}>{x.prev}</ButtonLink> : null}
              {(page + 1) * pageSize < total ? <ButtonLink size="sm" variant="secondary" href={href(page + 1)}>{x.next}</ButtonLink> : null}
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

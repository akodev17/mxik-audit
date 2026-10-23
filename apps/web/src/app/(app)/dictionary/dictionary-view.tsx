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
import { DICT_FILTERS, type DictFilter } from './dictionary-params';
import { DictionaryTable, type DictRow } from './dictionary-table';

export type DictionaryList = ResponseOf<typeof endpoints.dictionary.list>;

/** Every dictionary listing in the cache; an edit or delete refetches the one on screen. */
export const DICTIONARY = ['dictionary'] as const;

type Props = { q: string; filter: DictFilter; page: number; initial: DictionaryList; editable: boolean };

/** Filter chips with counts, the entries and the pager; the page read the first copy, edits refetch it. */
export function DictionaryView({ q, filter, page, initial, editable }: Props) {
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
  const rows: DictRow[] = data.rows.map(({ updatedAt, ...e }) => ({ ...e, updated: fmtDate(locale, updatedAt) }));
  const params = (over: { p?: number; f?: DictFilter }): string => {
    const f = over.f ?? filter;
    return `/dictionary?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== 'all' ? { f } : {}), page: String(over.p ?? 0) })}`;
  };
  const href = (p: number): string => params({ p });

  return (
    <>
      {counts.all > 0 ? (
        <nav aria-label={x.filterLabel} className="mb-3 flex flex-wrap items-center gap-1 text-small">
          {DICT_FILTERS.filter((f) => f === 'all' || f === filter || counts[f] > 0).map((f) => (
            <Link key={f} href={params({ f })} aria-current={f === filter ? 'true' : undefined} className={cx('rounded-ctl px-2.5 py-1 font-medium', f === filter ? 'bg-surface text-fg' : 'text-muted hover:bg-surface hover:text-fg')}>
              {x.filters[f]} <span className="tabular-nums text-subtle">{fmtNumber(locale, counts[f])}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      {filter === 'unverified' || filter === 'stale' ? <p className="mb-2 text-small text-muted">{x.filterHints[filter]}</p> : null}
      {rows.length === 0 ? (
        q || filter !== 'all' ? <EmptyState title={x.emptySearch} hint={x.emptySearchHint} /> : <EmptyState title={x.emptyTitle} hint={x.emptyHint} />
      ) : (
        <>
          {editable ? null : <p className="mb-2 text-small text-muted">{x.viewerHint}</p>}
          <DictionaryTable rows={rows} canEdit={editable} />
          <nav aria-label={x.pages} className="mt-3 flex flex-wrap items-center gap-3 text-small text-muted">
            <span>{x.total(fmtNumber(locale, total), total)}</span>
            {page > 0 ? <ButtonLink size="sm" href={href(page - 1)}>{x.prev}</ButtonLink> : null}
            {(page + 1) * pageSize < total ? <ButtonLink size="sm" href={href(page + 1)}>{x.next}</ButtonLink> : null}
          </nav>
        </>
      )}
    </>
  );
}

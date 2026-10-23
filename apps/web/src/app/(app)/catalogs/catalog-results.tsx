'use client';

import { useQuery } from '@tanstack/react-query';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { catalogKeys } from '@/lib/catalogs/client';
import { withQuery } from '@/lib/catalogs/report';
import type { CatalogListItem } from '@/lib/catalogs/types';
import { useI18n } from '@/lib/locale-client';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { IconUpload } from '@/ui/icons';
import { CatalogList } from './catalog-list';
import { DraftUploads } from './draft-uploads';

export type CatalogStatusFilter = 'ready' | 'analyzing' | 'failed';

type ListPage = { items: CatalogListItem[]; total: number; pageSize: number };

type Props = {
  /** The page's query: the client and status filters as written in the URL, the 1-based page. */
  client: string | undefined;
  status: CatalogStatusFilter | undefined;
  page: number;
  /** What the server page read, so the first paint needs no request. */
  initial: ListPage;
  initialDrafts: CatalogListItem[];
  /** May upload and delete (a writer outside a demo); drafts are listed only for them, on the first page. */
  writer: boolean;
  showClient: boolean;
  uploadHref: string;
};

/**
 * The catalogues and open drafts of /catalogs as React Query reads (catalogs.list), seeded by the
 * server render: deleting a catalogue invalidates them instead of rendering the page again.
 */
export function CatalogResults({ client, status, page, initial, initialDrafts, writer, showClient, uploadHref }: Props) {
  const { locale, t, ta } = useI18n();
  const words = ta.firmX.catalogs;
  const f = ta.importX.flow;
  const filter = client ? { clientId: client } : {};
  // Drafts are not catalogues in any status: a status filter hides them.
  const withDrafts = writer && page === 1 && !status;

  const list = useQuery({
    queryKey: [...catalogKeys.all, 'list', client ?? null, status ?? null, page],
    queryFn: () => api.catalogs.list({ ...filter, ...(status ? { status } : {}), page: page - 1, kind: 'catalogs' }),
    initialData: { ...initial, clients: [] },
    // Nothing kept between visits: the server render is always the starting point.
    gcTime: 0,
    staleTime: 30_000,
  });
  const drafts = useQuery({
    queryKey: [...catalogKeys.all, 'drafts', client ?? null],
    queryFn: () => api.catalogs.list({ ...filter, page: 0, kind: 'drafts' }),
    initialData: { items: initialDrafts, total: initialDrafts.length, pageSize: initial.pageSize, clients: [] },
    gcTime: 0,
    staleTime: 30_000,
    enabled: withDrafts,
  });

  const { items, total, pageSize } = list.data;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const params = { client, status };

  return (
    <>
      <DraftUploads drafts={withDrafts ? drafts.data.items : []} showClient={showClient} />

      {items.length === 0 ? (
        status ? (
          <EmptyState
            title={f.filteredEmpty} hint={f.filteredEmptyHint}
            action={<ButtonLink href={withQuery('/catalogs', { client }, {})} variant="secondary">{f.resetFilter}</ButtonLink>}
          />
        ) : (
          <EmptyState
            icon={<IconUpload size={22} />} title={ta.catalogs.emptyTitle} hint={ta.catalogs.emptyHint}
            action={writer ? <ButtonLink href={uploadHref} variant="secondary">{ta.catalogs.uploadCta}</ButtonLink> : null}
          />
        )
      ) : (
        <>
          <p className="mb-2 text-small text-muted">{words.total(fmtNumber(locale, total), total)}</p>
          <CatalogList items={items} showClient={showClient} canDelete={writer} refreshAfterDelete={false} />
          {pages > 1 ? (
            <nav aria-label={t.catalogsTitle} className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-small text-muted">{ta.firmX.clients.page(page, pages)}</span>
              <span className="flex gap-2">
                {page > 1 ? <ButtonLink href={withQuery('/catalogs', params, { page: page - 1 > 1 ? String(page - 1) : null })} size="sm" variant="secondary">{ta.firmX.clients.prev}</ButtonLink> : null}
                {page < pages ? <ButtonLink href={withQuery('/catalogs', params, { page: String(page + 1) })} size="sm" variant="secondary">{ta.firmX.clients.next}</ButtonLink> : null}
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}

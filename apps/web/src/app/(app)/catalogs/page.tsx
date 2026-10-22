import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { canWrite, clientScope } from '@tasnivo/domain/access';
import { CATALOG_PAGE, catalogList } from '@tasnivo/domain/catalogs';
import { db } from '@tasnivo/db';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { withQuery } from '@tasnivo/domain/query-string';
import { currentUser } from '@/lib/session';
import { ButtonLink } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Page } from '@/ui/page';
import { Select } from '@/ui/select';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';
import { CatalogList } from './catalog-list';
import { DraftUploads } from './draft-uploads';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.catalogsTitle} — ${t.appName}` };
}

type Params = { client?: string; page?: string };

export default async function CatalogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { locale, t, ta } = await getI18n();
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const sp = await searchParams;
  const words = ta.firmX.catalogs;

  const clients = await db.client.findMany({
    where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  // No choice made: the client being worked on; "all" or a single client shows everything.
  const requested = sp.client === 'all' ? null : clients.find((c) => c.id === (sp.client ?? user.clientId))?.id ?? null;
  const clientId = clients.length > 1 ? requested : null;
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const writer = canWrite(user) && !user.demo;
  // Unconfirmed uploads are listed apart, on the first page, for those who can finish them.
  const [{ items, total }, drafts] = await Promise.all([
    catalogList(user, clientId, page - 1),
    writer && page === 1 ? catalogList(user, clientId, 0, 'drafts') : Promise.resolve({ items: [] }),
  ]);
  const pages = Math.max(1, Math.ceil(total / CATALOG_PAGE));
  const params = { client: sp.client };

  return (
    <Page
      title={t.catalogsTitle} hint={words.hint} wide
      actions={writer ? <ButtonLink href={clientId ? `/upload?client=${clientId}` : '/upload'} variant="primary">{ta.catalogs.uploadCta}</ButtonLink> : null}
    >
      {clients.length > 1 ? (
        <FilterBar action="/catalogs" reset={clientId ? '/catalogs?client=all' : null} compact fieldsClassName="grid-cols-1 sm:w-80">
          <Select label={words.client} name="client" defaultValue={clientId ?? 'all'} wrapperClassName={FILTER_FIELD}>
            <option value="all">{words.allClients}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FilterBar>
      ) : null}
      {canWrite(user) ? null : <p className="mb-4 text-small text-muted">{words.readOnly}</p>}
      <DraftUploads drafts={drafts.items} showClient={clientId === null && clients.length > 1} />

      {items.length === 0 ? (
        <EmptyState
          title={ta.catalogs.emptyTitle} hint={ta.catalogs.emptyHint}
          action={writer ? <ButtonLink href={clientId ? `/upload?client=${clientId}` : '/upload'} variant="secondary">{ta.catalogs.uploadCta}</ButtonLink> : null}
        />
      ) : (
        <>
          <p className="mb-2 text-small text-muted">{words.total(fmtNumber(locale, total), total)}</p>
          <CatalogList items={items} showClient={clientId === null && clients.length > 1} canDelete={writer} />
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
    </Page>
  );
}

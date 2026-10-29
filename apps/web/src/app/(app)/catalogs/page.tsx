import type { Metadata } from 'next';
import { serverApi } from '@/lib/api/server';
import { canWrite } from '@/lib/catalogs/report';
import { signedInUser } from '@/lib/catalogs/server';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { Page } from '@/ui/page';
import { Select } from '@/ui/select';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';
import { CatalogResults, type CatalogStatusFilter } from './catalog-results';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.catalogsTitle} — ${t.appName}` };
}

type Params = { client?: string; status?: string; page?: string };

const STATUSES: readonly CatalogStatusFilter[] = ['ready', 'analyzing', 'failed'];

export default async function CatalogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t, ta } = await getI18n();
  const user = await signedInUser();
  const sp = await searchParams;
  const words = ta.firmX.catalogs;
  const f = ta.importX.flow;
  const status = STATUSES.find((s) => s === sp.status);

  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const writer = canWrite(user) && !user.demo;
  const api = serverApi();
  const client = sp.client ? { clientId: sp.client } : {};
  // Unconfirmed uploads are listed apart, on the first page, for those who can finish them.
  const [{ items, total, pageSize, clients, clientId }, drafts] = await Promise.all([
    api.catalogs.list({ ...client, ...(status ? { status } : {}), page: page - 1, kind: 'catalogs' }),
    writer && page === 1 && !status ? api.catalogs.list({ ...client, page: 0, kind: 'drafts' }) : Promise.resolve({ items: [] }),
  ]);
  // The API chose the client: no choice made = the header switcher's active one (B4); "all" or a single client = everything.
  const uploadHref = clientId ? `/upload?client=${clientId}` : '/upload';

  return (
    <Page
      title={t.catalogsTitle} hint={words.hint} wide
      actions={writer ? <ButtonLink href={uploadHref} variant="primary">{ta.catalogs.uploadCta}</ButtonLink> : null}
    >
      <FilterBar
        action="/catalogs" reset={clientId || status ? '/catalogs?client=all' : null} compact
        fieldsClassName={clients.length > 1 ? 'grid-cols-1 sm:w-[34rem] sm:grid-cols-2' : 'grid-cols-1 sm:w-64'}
      >
        {clients.length > 1 ? (
          <Select label={words.client} name="client" defaultValue={clientId ?? 'all'} wrapperClassName={FILTER_FIELD}>
            <option value="all">{words.allClients}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        ) : null}
        <Select label={f.statusFilter} name="status" defaultValue={status ?? ''} wrapperClassName={FILTER_FIELD}>
          <option value="">{f.allStatuses}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t.catalogStatus[s]}</option>)}
        </Select>
      </FilterBar>
      {canWrite(user) ? null : <p className="mb-4 text-small text-muted">{words.readOnly}</p>}

      <CatalogResults
        client={sp.client} status={status} page={page} initial={{ items, total, pageSize }} initialDrafts={drafts.items}
        writer={writer} canDelete={user.role === 'admin' && !user.demo} showClient={clientId === null && clients.length > 1} uploadHref={uploadHref}
      />
    </Page>
  );
}

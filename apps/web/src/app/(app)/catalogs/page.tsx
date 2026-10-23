import type { Metadata } from 'next';
import { serverApi } from '@/lib/api/server';
import { canWrite } from '@/lib/catalogs/report';
import { signedInUser } from '@/lib/catalogs/server';
import { getI18n } from '@/lib/locale';
import { ButtonLink } from '@/ui/button';
import { Page } from '@/ui/page';
import { Select } from '@/ui/select';
import { FILTER_FIELD, FilterBar } from '../queue/filter-bar';
import { CatalogResults } from './catalog-results';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.catalogsTitle} — ${t.appName}` };
}

type Params = { client?: string; page?: string };

export default async function CatalogsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { t, ta } = await getI18n();
  const user = await signedInUser();
  const sp = await searchParams;
  const words = ta.firmX.catalogs;

  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const writer = canWrite(user) && !user.demo;
  const api = serverApi();
  const client = sp.client ? { clientId: sp.client } : {};
  // Unconfirmed uploads are listed apart, on the first page, for those who can finish them.
  const [{ items, total, pageSize, clients }, drafts] = await Promise.all([
    api.catalogs.list({ ...client, page: page - 1, kind: 'catalogs' }),
    writer && page === 1 ? api.catalogs.list({ ...client, page: 0, kind: 'drafts' }) : Promise.resolve({ items: [] }),
  ]);
  // No choice made: the client being worked on; "all" or a single client shows everything (the API chose the same).
  const requested = sp.client === 'all' ? null : clients.find((c) => c.id === (sp.client ?? user.clientId))?.id ?? null;
  const clientId = clients.length > 1 ? requested : null;
  const uploadHref = clientId ? `/upload?client=${clientId}` : '/upload';

  return (
    <Page
      title={t.catalogsTitle} hint={words.hint} wide
      actions={writer ? <ButtonLink href={uploadHref} variant="primary">{ta.catalogs.uploadCta}</ButtonLink> : null}
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

      <CatalogResults
        client={sp.client} page={page} initial={{ items, total, pageSize }} initialDrafts={drafts.items}
        writer={writer} showClient={clientId === null && clients.length > 1} uploadHref={uploadHref}
      />
    </Page>
  );
}

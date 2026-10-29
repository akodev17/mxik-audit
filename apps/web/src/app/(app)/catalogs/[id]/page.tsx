import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { canWrite } from '@/lib/catalogs/report';
import { signedIn } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { catalogHeader, orNotFound, orNull, signedInUser } from '@/lib/catalogs/server';
import { apiFilter, filterKey, readFilter, readHidden, viewQuery } from '@/lib/workspace-url';
import { CatalogStatus } from '@/ui/catalog-status';
import { FailedRows } from './failed-rows';
import { MoneyAtRisk } from './money-at-risk';
import { Workspace } from './workspace';
import { WorkspaceHeader } from './workspace-header';

type Params = { params: Promise<{ id: string }> };

/** The tab says which catalogue is open; an id the user may not see reads like any missing page, never its name. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const { id } = await params;
  // catalogs.get, read once per request with the page (React cache).
  const catalog = (await signedIn()) ? await orNull(catalogHeader(id)) : null;
  return { title: `${catalog?.filename ?? ta.shellX.notFound.title} — ${t.appName}` };
}

type SearchParams = {
  type?: string; q?: string; pending?: string; dec?: string; flag?: string; comments?: string; sort?: string; source?: string;
  v?: string; density?: string; grouped?: string; cols?: string;
  /** A finding to open (queue links): its drawer opens and the grid scrolls to it. */
  row?: string;
};

export default async function CatalogWorkspacePage({ params, searchParams }: Params & { searchParams: Promise<SearchParams> }) {
  const user = await signedInUser();
  const { id } = await params;
  const sp = await searchParams;
  const { ta } = await getI18n();

  // The header read (catalogs.get): an id that is not this org's is the same 404 as a missing one;
  // the API resumes an audit whose worker died.
  const catalog = await orNotFound(catalogHeader(id));
  const client = catalog.client;

  if (catalog.status !== 'ready') {
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader catalog={catalog} user={user} />
        <CatalogStatus catalog={catalog} />
      </div>
    );
  }

  // The grid's data comes from the API as well (workspace.*), with the browser's cookie forwarded.
  const api = serverApi();
  // A bare URL opens the user's default view, if they saved one.
  if (Object.keys(sp).length === 0) {
    const preferred = (await api.workspace.views()).find((v) => v.isDefault);
    if (preferred) redirect(`/catalogs/${catalog.id}?${viewQuery(preferred.params)}`);
  }
  const filter = readFilter(sp);
  const writer = canWrite(user);
  // Rows the audit could not check have no findings to page through: their own list.
  if (filter.type === 'FAILED') {
    const failed = await api.workspace.failedRows({ catalogId: catalog.id });
    return (
      <div className="flex min-h-full flex-col">
        <WorkspaceHeader catalog={catalog} user={user} canShare={writer} showReview />
        <FailedRows catalogId={catalog.id} data={failed} canRetry={writer && !catalog.demo} />
      </div>
    );
  }
  // A linked finding not on the first page leads the list; the API keeps it to this catalogue.
  const wanted = typeof sp.row === 'string' && sp.row.length > 0 && sp.row.length <= 64 ? sp.row : null;
  const query = { catalogId: catalog.id, ...apiFilter(filter) };
  const [summary, counts, page] = await Promise.all([
    api.catalogs.summary({ catalogId: catalog.id }),
    api.workspace.counts(query),
    api.workspace.rows({ ...query, ...(wanted ? { row: wanted } : {}) }),
  ]);
  if (!page) notFound();
  const focusRow = wanted && page.rows.some((r) => r.findingId === wanted) ? wanted : null;

  return (
    <div className="flex min-h-full flex-col md:h-full">
      <WorkspaceHeader catalog={catalog} user={user} canShare={writer} showReview />
      <Suspense fallback={null}>
        <MoneyAtRisk catalogId={catalog.id} />
      </Suspense>
      <Workspace
        key={`${catalog.id}|${filterKey(filter)}`}
        catalogId={catalog.id}
        clientId={client.id}
        summary={summary}
        counts={counts}
        firstPage={page}
        filter={filter}
        focusRow={focusRow}
        hintKey={user.demo ? `mxik.hint.${user.orgId}` : null}
        readOnly={!writer}
        initialDensity={sp.density === 'compact' ? 'compact' : sp.density === 'comfortable' ? 'comfortable' : null}
        initialGrouped={sp.grouped === '1'}
        initialHidden={sp.cols !== undefined ? readHidden(sp.cols) : null}
        saveBlocked={!writer ? ta.wsX.view.viewerSave : user.demo ? ta.wsX.view.demoSave : null}
        exportLocked={catalog.exportLocked}
      />
    </div>
  );
}

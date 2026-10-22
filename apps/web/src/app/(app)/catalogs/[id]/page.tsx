import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cache, Suspense } from 'react';
import { resumeStaleAudits, STALE_MS } from '@tasnivo/domain/audit-jobs';
import { resolveClient } from '@tasnivo/domain/clients';
import { canWrite, catalogScope, isAdminRole } from '@tasnivo/domain/access';
import { db } from '@tasnivo/db';
import { currentUser, inDemoOrg, type CurrentUser } from '@/lib/session';
import { serverApi } from '@/lib/api/server';
import { apiFilter, filterKey, readFilter, readHidden, viewQuery } from '@/lib/workspace-url';
import { CatalogStatus } from '@/ui/catalog-status';
import { MoneyAtRisk } from './money-at-risk';
import { Workspace } from './workspace';
import { exportLocked, WorkspaceHeader } from './workspace-header';

type Params = { params: Promise<{ id: string }> };

/** The catalogue if this user may see it; the tab title and the page share one read per request. */
const visibleCatalog = cache((id: string, user: CurrentUser) => db.catalog.findFirst({ where: { id, ...catalogScope(user) } }));

/** The tab says which catalogue is open; an id the user may not see reads like any missing page, never its name. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t, ta } = await getI18n();
  const user = await currentUser();
  const { id } = await params;
  const catalog = user ? await visibleCatalog(id, user) : null;
  return { title: `${catalog?.filename ?? ta.shellX.notFound.title} — ${t.appName}` };
}

type SearchParams = {
  type?: string; q?: string; pending?: string; dec?: string; flag?: string; comments?: string; sort?: string; source?: string;
  v?: string; density?: string; grouped?: string; cols?: string;
  /** A finding to open (queue links): its drawer opens and the grid scrolls to it. */
  row?: string;
};

export default async function CatalogWorkspacePage({ params, searchParams }: Params & { searchParams: Promise<SearchParams> }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const sp = await searchParams;
  const { ta } = await getI18n();

  // An id that is not this org's is indistinguishable from one that does not exist.
  const catalog = await visibleCatalog(id, user);
  if (!catalog) notFound();
  const [client, demo] = await Promise.all([resolveClient(user.orgId, catalog.clientId), inDemoOrg(user)]);
  const header = { orgId: user.orgId, catalog, client, canPay: isAdminRole(user), demo };

  if (catalog.status !== 'ready') {
    // Picks up an audit whose worker died (server restart, crash).
    if (catalog.status === 'analyzing') await resumeStaleAudits(STALE_MS, catalog.id);
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader {...header} />
        <CatalogStatus catalog={catalog} />
      </div>
    );
  }

  // The grid's data comes from the API (the header above still reads its own).
  const api = serverApi();
  // A bare URL opens the user's default view, if they saved one.
  if (Object.keys(sp).length === 0) {
    const preferred = (await api.workspace.views()).find((v) => v.isDefault);
    if (preferred) redirect(`/catalogs/${catalog.id}?${viewQuery(preferred.params)}`);
  }
  const filter = readFilter(sp);
  const writer = canWrite(user);
  // A linked finding not on the first page leads the list; the API keeps it to this catalogue.
  const wanted = typeof sp.row === 'string' && sp.row.length > 0 && sp.row.length <= 64 ? sp.row : null;
  const query = { catalogId: catalog.id, ...apiFilter(filter) };
  const [summary, counts, page, locked] = await Promise.all([
    api.catalogs.summary({ catalogId: catalog.id }),
    api.workspace.counts(query),
    api.workspace.rows({ ...query, ...(wanted ? { row: wanted } : {}) }),
    exportLocked(user.orgId, catalog.id),
  ]);
  if (!page) notFound();
  const focusRow = wanted && page.rows.some((r) => r.findingId === wanted) ? wanted : null;

  return (
    <div className="flex min-h-full flex-col md:h-full">
      <WorkspaceHeader {...header} canShare={writer} viewer={user} />
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
        exportLocked={locked}
      />
    </div>
  );
}

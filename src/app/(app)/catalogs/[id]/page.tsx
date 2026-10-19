import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { resumeStaleAudits, STALE_MS } from '@/lib/audit-jobs';
import { resolveClient } from '@/lib/clients';
import { canWrite, catalogScope, isAdminRole } from '@/lib/access';
import { db } from '@/lib/db';
import { isDemoOrg } from '@/lib/demo';
import { currentUser } from '@/lib/session';
import { defaultView } from '@/lib/views';
import { readHidden, viewQuery } from '@/lib/view-params';
import { decodeCursor, workspaceCount, workspacePageIds, workspaceSummary } from '@/lib/workspace';
import { filterKey, readFilter } from '@/lib/workspace-filter';
import { gridRows } from '@/lib/workspace-rows';
import { CatalogStatus } from '@/ui/catalog-status';
import { MoneyAtRisk } from './money-at-risk';
import { Workspace } from './workspace';
import { exportLocked, WorkspaceHeader } from './workspace-header';

type Params = { params: Promise<{ id: string }> };

/** The tab says which catalogue is open; an id the user may not see gets the generic title. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t } = await getI18n();
  const user = await currentUser();
  const { id } = await params;
  const catalog = user ? await db.catalog.findFirst({ where: { id, ...catalogScope(user) }, select: { filename: true } }) : null;
  return { title: `${catalog?.filename ?? t.navCatalogs} — ${t.appName}` };
}

const FIRST_PAGE = 120;

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
  const { ta, locale } = await getI18n();

  // An id that is not this org's is indistinguishable from one that does not exist.
  const catalog = await db.catalog.findFirst({ where: { id, ...catalogScope(user) } });
  if (!catalog) notFound();
  const [client, demo] = await Promise.all([resolveClient(user.orgId, catalog.clientId), isDemoOrg(user.orgId)]);
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

  // A bare URL opens the user's default view, if they saved one.
  if (Object.keys(sp).length === 0) {
    const preferred = await defaultView(user);
    if (preferred) redirect(`/catalogs/${catalog.id}?${viewQuery(preferred.params)}`);
  }
  const filter = readFilter(sp);
  const writer = canWrite(user);
  const [summary, count, page, locked] = await Promise.all([
    workspaceSummary(catalog.id, catalog.rowCount),
    workspaceCount(catalog.id, filter),
    workspacePageIds(catalog.id, filter, decodeCursor(null), FIRST_PAGE),
    exportLocked(user.orgId, catalog.id),
  ]);
  // A linked finding not on the first page leads the list; gridRows keeps it to this catalogue.
  const wanted = typeof sp.row === 'string' && sp.row.length > 0 && sp.row.length <= 64 ? sp.row : null;
  const ids = wanted && !page.ids.includes(wanted) ? [wanted, ...page.ids] : page.ids;
  const rows = await gridRows(user.orgId, catalog.id, ids, locale);
  const focusRow = wanted && rows.some((r) => r.findingId === wanted) ? wanted : null;

  return (
    <div className="flex min-h-full flex-col md:h-full">
      <WorkspaceHeader {...header} canShare={writer} />
      <Suspense fallback={null}>
        <MoneyAtRisk catalogId={catalog.id} columnMap={catalog.columnMap} />
      </Suspense>
      <Workspace
        key={`${catalog.id}|${filterKey(filter)}`}
        catalogId={catalog.id}
        clientId={client.id}
        summary={summary}
        initialRows={rows}
        initialNext={page.next}
        count={count}
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

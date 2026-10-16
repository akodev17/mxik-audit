import { getI18n } from '@/lib/locale';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { resumeStaleAudits, STALE_MS } from '@/lib/audit-jobs';
import { resolveClient } from '@/lib/clients';
import { canWrite, catalogScope } from '@/lib/access';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { decodeCursor, readFilter, workspaceCount, workspacePageIds, workspaceSummary } from '@/lib/workspace';
import { gridRows } from '@/lib/workspace-rows';
import { CatalogStatus } from '@/ui/catalog-status';
import { MoneyAtRisk } from './money-at-risk';
import { Workspace } from './workspace';
import { WorkspaceHeader } from './workspace-header';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: `${t.navCatalogs} — ${t.appName}` };
}

const FIRST_PAGE = 120;

type SearchParams = { type?: string; q?: string; pending?: string; comments?: string };

export default async function CatalogWorkspacePage(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> },
) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const { id } = await params;
  const sp = await searchParams;

  // An id that is not this org's is indistinguishable from one that does not exist.
  const catalog = await db.catalog.findFirst({ where: { id, ...catalogScope(user) } });
  if (!catalog) notFound();
  const client = await resolveClient(user.orgId, catalog.clientId);

  if (catalog.status !== 'ready') {
    // Picks up an audit whose worker died (server restart, crash).
    if (catalog.status === 'analyzing') await resumeStaleAudits(STALE_MS, catalog.id);
    return (
      <div className="flex h-full flex-col">
        <WorkspaceHeader orgId={user.orgId} catalog={catalog} client={client} />
        <CatalogStatus catalog={catalog} />
      </div>
    );
  }

  const filter = readFilter(sp);
  const [summary, count, page] = await Promise.all([
    workspaceSummary(catalog.id, catalog.rowCount),
    workspaceCount(catalog.id, filter),
    workspacePageIds(catalog.id, filter, decodeCursor(null), FIRST_PAGE),
  ]);
  const rows = await gridRows(user.orgId, catalog.id, page.ids);

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader orgId={user.orgId} catalog={catalog} client={client} canShare={canWrite(user) && catalog.status === 'ready'} />
      <Suspense fallback={null}>
        <MoneyAtRisk catalogId={catalog.id} columnMap={catalog.columnMap} />
      </Suspense>
      <Workspace
        key={`${catalog.id}|${filter.type}|${filter.q}|${filter.pendingOnly}|${filter.commented}`}
        catalogId={catalog.id}
        summary={summary}
        initialRows={rows}
        initialNext={page.next}
        count={count}
        filter={filter}
        hintKey={user.demo ? `mxik.hint.${user.orgId}` : null}
        readOnly={!canWrite(user)}
      />
    </div>
  );
}

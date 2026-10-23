// What the catalogue screens read, as one call each: the list, the upload wizard's resume, the
// audit progress, the workspace header and totals, versions and their diff, the report and the
// review task. The API's catalogs module answers with these; the web pages assemble the same
// data themselves until W3 moves them onto the API. Every read is scoped like the pages were
// (catalogScope): another org's or another client's catalogue is null, the same as a missing one.
import { db } from '@tasnivo/db';
import { canWrite, catalogScope, clientScope } from './access.js';
import { resumeStaleAudits, STALE_MS } from './audit-jobs.js';
import { billingConfig } from './billing/config.js';
import { catalogPaid } from './billing/orders.js';
import { CATALOG_PAGE, catalogList, type CatalogListItem } from './catalogs.js';
import { resolveClient } from './clients.js';
import { isDemoOrg } from './demo.js';
import { reportPdfData, type ReportPdfData } from './pdf/report-data.js';
import { uploadsOpen } from './plan.js';
import { readPipelineMeta, type PipelineMeta } from './pipeline-meta.js';
import { assignableMembers, reviewsFor, type Assignable, type ReviewView } from './review-assignments.js';
import { countView, resolveShare } from './share.js';
import type { CurrentUser } from './session.js';
import { uploadPreview, type UploadPreview } from './upload-preview.js';
import { uploadProgress, type UploadProgress } from './upload-progress.js';
import { compareCandidates, versionDiff, type CompareCandidate, type VersionDiff } from './versions.js';
import { workspaceSummary, type WsSummary } from './workspace.js';

type Viewer = Pick<CurrentUser, 'userId' | 'orgId' | 'clientId' | 'clientIds' | 'role' | 'demo'>;

/** The catalogue if this user may see it. */
export function visibleCatalog(user: Pick<CurrentUser, 'orgId' | 'clientIds'>, catalogId: string) {
  return db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(user) } });
}

export type CatalogListPage = { items: CatalogListItem[]; total: number; pageSize: number; clients: { id: string; name: string }[] };

/**
 * The catalogues list (catalogs/page.tsx): the client filter options, and one page of catalogues
 * or of drafts. Without a client the one being worked on is shown, "all" shows every client;
 * with a single client there is nothing to filter. Drafts are only for those who can finish them.
 */
export async function catalogListPage(user: Viewer, input: { clientId?: string; page: number; kind: 'catalogs' | 'drafts'; status?: 'ready' | 'analyzing' | 'failed' }): Promise<CatalogListPage> {
  const clients = await db.client.findMany({
    where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  const requested = input.clientId === 'all' ? null : clients.find((c) => c.id === (input.clientId ?? user.clientId))?.id ?? null;
  const clientId = clients.length > 1 ? requested : null;
  const writer = canWrite(user) && !user.demo;
  const { items, total } = input.kind === 'drafts' && !writer
    ? { items: [], total: 0 }
    : await catalogList(user, clientId, input.page, input.kind, input.kind === 'catalogs' ? input.status : undefined);
  return { items, total, pageSize: CATALOG_PAGE, clients };
}

/**
 * The upload page: the clients a catalogue can be uploaded for (not archived, in the user's
 * scope, the default one first) and whether the plan lets anything be uploaded.
 */
export async function uploadOptions(user: Viewer): Promise<{ clients: { id: string; name: string }[]; uploadsOpen: boolean }> {
  const [clients, open] = await Promise.all([
    db.client.findMany({
      where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
    uploadsOpen(user.orgId),
  ]);
  return { clients, uploadsOpen: open.ok };
}

/** The wizard's preview of an upload still waiting for its mapping (/upload?catalog=…). */
export function catalogPreview(user: Viewer, catalogId: string): Promise<UploadPreview | null> {
  return uploadPreview(user, catalogId);
}

/**
 * Audit progress, polled by the wizard. An audit whose worker died (server restart) is handed to
 * jobs() again, as the old /upload/progress route and the workspace page did.
 */
export async function catalogProgress(user: Viewer, catalogId: string): Promise<UploadProgress | null> {
  const progress = await uploadProgress(user, catalogId);
  if (progress?.status === 'analyzing') await resumeStaleAudits(STALE_MS, catalogId);
  return progress;
}

/** Whether the corrected file needs a payment first (billing turned on for exports and not paid). */
export async function exportLocked(orgId: string, catalogId: string): Promise<boolean> {
  return billingConfig().requiredForExport ? !(await catalogPaid(orgId, catalogId)) : false;
}

export type CatalogHeader = {
  id: string; filename: string; status: 'uploaded' | 'analyzing' | 'ready' | 'failed'; createdAt: Date; rowCount: number; progressDone: number;
  previousId: string | null;
  client: { id: string; name: string; isDefault: boolean };
  demo: boolean;
  pipeline: PipelineMeta | null;
  snapshot: { usedTakenAt: Date | null; newerTakenAt: Date | null };
  exportLocked: boolean;
};

/** The workspace header (catalogs/[id]/page.tsx + workspace-header.tsx). Resumes a stalled audit like the page. */
export async function catalogHeader(user: Viewer, catalogId: string): Promise<CatalogHeader | null> {
  const catalog = await visibleCatalog(user, catalogId);
  if (!catalog) return null;
  if (catalog.status === 'analyzing') await resumeStaleAudits(STALE_MS, catalog.id);
  const [client, demo, used, latest, locked] = await Promise.all([
    resolveClient(user.orgId, catalog.clientId),
    isDemoOrg(user.orgId),
    catalog.snapshotId ? db.catalogSnapshot.findUnique({ where: { id: catalog.snapshotId }, select: { id: true, takenAt: true } }) : null,
    db.catalogSnapshot.findFirst({ orderBy: { id: 'desc' }, select: { id: true, takenAt: true } }),
    exportLocked(user.orgId, catalog.id),
  ]);
  const newer = used && latest && latest.id > used.id ? latest : null;
  return {
    id: catalog.id, filename: catalog.filename, status: catalog.status, createdAt: catalog.createdAt, rowCount: catalog.rowCount,
    progressDone: catalog.progressDone, previousId: catalog.previousId, client, demo,
    pipeline: readPipelineMeta(catalog.pipelineMeta),
    snapshot: { usedTakenAt: used?.takenAt ?? null, newerTakenAt: newer?.takenAt ?? null },
    exportLocked: locked,
  };
}

/** The workspace's totals strip. */
export async function catalogSummary(user: Viewer, catalogId: string): Promise<WsSummary | null> {
  const catalog = await visibleCatalog(user, catalogId);
  return catalog ? workspaceSummary(catalog.id, catalog.rowCount) : null;
}

/** Earlier ready catalogues of the same client this one can be compared with. */
export async function catalogVersions(user: Viewer, catalogId: string): Promise<CompareCandidate[] | null> {
  const catalog = await visibleCatalog(user, catalogId);
  return catalog ? compareCandidates(user.orgId, catalog.id) : null;
}

export type DiffQuery = { with?: string; limit?: number; offset?: number };

/**
 * The diff page: against `with` when that is a version it can be compared with, else against the
 * previous version. `found` is false for a catalogue the user may not see; `diff` null when there
 * is nothing to compare with.
 */
export async function catalogDiff(user: Viewer, catalogId: string, query: DiffQuery): Promise<{ found: boolean; diff: VersionDiff | null }> {
  const catalog = await visibleCatalog(user, catalogId);
  if (!catalog) return { found: false, diff: null };
  const window = { ...(query.limit !== undefined ? { limit: query.limit } : {}), ...(query.offset !== undefined ? { offset: query.offset } : {}) };
  const chosen = query.with ? await versionDiff(user.orgId, catalog.id, query.with, window) : null;
  return { found: true, diff: chosen ?? await versionDiff(user.orgId, catalog.id, undefined, window) };
}

/** ReportPdfData as JSON: the logo as a data: URL, and who decided only on the internal report. */
export type ReportJson = Omit<ReportPdfData, 'logo'> & { logoUrl: string | null };

export function reportJson(data: ReportPdfData, audience: 'internal' | 'client'): ReportJson {
  const { logo, rows, ...rest } = data;
  return {
    ...rest,
    logoUrl: logo ? `data:${logo.mime};base64,${logo.data.toString('base64')}` : null,
    rows: audience === 'internal' ? rows : rows.map((r) => ({ ...r, decidedBy: null })),
  };
}

export type ReportRead = { ok: true; report: ReportJson } | { ok: false; reason: 'not_found' | 'not_ready' };

/** The report page (internal: with who decided). */
export async function catalogReport(user: Viewer, catalogId: string): Promise<ReportRead> {
  const catalog = await visibleCatalog(user, catalogId);
  if (!catalog) return { ok: false, reason: 'not_found' };
  if (catalog.status !== 'ready') return { ok: false, reason: 'not_ready' };
  const data = await reportPdfData(user.orgId, catalog.id);
  return data ? { ok: true, report: reportJson(data, 'internal') } : { ok: false, reason: 'not_found' };
}

/**
 * The review field of the header (review-field.tsx): the task, if the user may see it, and the
 * members it can be given to, for a writer outside a demo.
 */
export async function catalogReview(user: Viewer, catalogId: string): Promise<{ review: ReviewView | null; assignable: Assignable[] } | null> {
  const catalog = await visibleCatalog(user, catalogId);
  if (!catalog) return null;
  if (!catalog.clientId) return { review: null, assignable: [] };
  const writes = canWrite(user) && !(await isDemoOrg(user.orgId));
  const [seen, assignable] = await Promise.all([
    reviewsFor(user, [catalog.id]),
    writes ? assignableMembers(user, catalog.clientId) : Promise.resolve([]),
  ]);
  return { review: seen.get(catalog.id) ?? null, assignable };
}

/**
 * The share page (r/[token]): the client-facing report behind a live link, counting one view.
 * Null for an unknown, expired or revoked token, or a link of a closed account.
 */
export async function shareView(token: string): Promise<{ report: ReportJson; includePdf: boolean } | null> {
  const share = await resolveShare(token);
  const data = share ? await reportPdfData(share.orgId, share.catalogId) : null;
  if (!share || !data) return null;
  await countView(share.id);
  return { report: reportJson(data, 'client'), includePdf: share.includePdf };
}

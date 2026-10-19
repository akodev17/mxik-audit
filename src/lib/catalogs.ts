// Catalogue history and deletion, scoped by org. Deleting a catalogue removes
// its rows, findings and cached AI verdicts, but never audit-log rows: the log
// is append-only, so its events stay (pointing at a catalogue that no longer
// exists) and a tombstone event records the deletion.
import { normalizeName } from '../core/normalize/index.js';
import { rerankCacheKey } from '../core/match/rerank-cache.js';
import { catalogScope } from './access.js';
import { db } from './db.js';
import type { Actor, Result } from './decisions.js';
import { RISKY_ITEM } from './risk.js';
import { mayWrite } from './write-access.js';

export type CatalogSummary = {
  id: string;
  clientId: string | null;
  filename: string;
  rowCount: number;
  status: string;
  createdAt: Date;
  riskyRows: number;
};

/** The org's catalogues, optionally only one client's. */
export async function listCatalogs(orgId: string, clientId?: string | null, scope?: string[] | null): Promise<CatalogSummary[]> {
  const catalogs = await db.catalog.findMany({
    where: { orgId, ...(clientId ? { clientId } : scope ? { clientId: { in: scope } } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, clientId: true, filename: true, rowCount: true, status: true, createdAt: true,
      _count: { select: { items: { where: RISKY_ITEM } } },
    },
  });
  return catalogs.map(({ _count, ...c }) => ({ ...c, riskyRows: _count.items }));
}

export type CatalogListItem = {
  id: string;
  clientId: string | null;
  clientName: string | null;
  filename: string;
  rowCount: number;
  status: 'uploaded' | 'analyzing' | 'ready' | 'failed';
  createdAt: Date;
  /** Null until the audit has finished: an unaudited file has no risk count yet. */
  riskyRows: number | null;
  uploader: string | null;
  viaTelegram: boolean;
  /** Same file name uploaded more than once in this list. */
  repeatedName: boolean;
};

export const CATALOG_PAGE = 50;

/**
 * Catalogues the user may see, newest first: one client's, or every client's
 * except archived ones. Each row says who uploaded it, so same-name uploads
 * can be told apart. Uploads whose columns were never confirmed are drafts,
 * listed apart (kind 'drafts') so they do not read as catalogues.
 */
export async function catalogList(
  user: { orgId: string; clientIds?: string[] | null }, clientId: string | null, page = 0, kind: 'catalogs' | 'drafts' = 'catalogs',
): Promise<{ items: CatalogListItem[]; total: number }> {
  const status = kind === 'drafts' ? { status: 'uploaded' as const } : { status: { not: 'uploaded' as const } };
  const where = { AND: [catalogScope(user), clientId ? { clientId } : { client: { archivedAt: null } }, status] };
  const [total, catalogs] = await Promise.all([
    db.catalog.count({ where }),
    db.catalog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: Math.max(0, page) * CATALOG_PAGE,
      take: CATALOG_PAGE,
      select: {
        id: true, clientId: true, filename: true, rowCount: true, status: true, createdAt: true,
        client: { select: { name: true } },
        _count: { select: { items: { where: RISKY_ITEM } } },
      },
    }),
  ]);
  const ids = catalogs.map((c) => c.id);
  const uploads = ids.length === 0 ? [] : await db.auditEvent.findMany({
    where: { orgId: user.orgId, action: 'catalog.uploaded', targetId: { in: ids } },
    select: { targetId: true, actorId: true, payload: true },
  });
  const actors = await db.user.findMany({
    where: { orgId: user.orgId, id: { in: uploads.flatMap((u) => (u.actorId ? [u.actorId] : [])) } },
    select: { id: true, email: true },
  });
  const email = new Map(actors.map((a) => [a.id, a.email]));
  const upload = new Map(uploads.map((u) => [u.targetId, u]));
  const nameCount = new Map<string, number>();
  for (const c of catalogs) nameCount.set(`${c.clientId}|${c.filename}`, (nameCount.get(`${c.clientId}|${c.filename}`) ?? 0) + 1);

  return {
    total,
    items: catalogs.map((c) => {
      const u = upload.get(c.id);
      const payload = u && typeof u.payload === 'object' && u.payload !== null && !Array.isArray(u.payload) ? u.payload as Record<string, unknown> : {};
      return {
        id: c.id, clientId: c.clientId, clientName: c.client?.name ?? null, filename: c.filename, rowCount: c.rowCount,
        status: c.status, createdAt: c.createdAt,
        riskyRows: c.status === 'ready' ? c._count.items : null,
        uploader: u?.actorId ? email.get(u.actorId) ?? null : null,
        viaTelegram: payload['via'] === 'telegram',
        repeatedName: (nameCount.get(`${c.clientId}|${c.filename}`) ?? 0) > 1,
      };
    }),
  };
}

/**
 * The catalogue a screen should show: the requested one if it belongs to the
 * org, otherwise none; else the latest of the given client (or of the org).
 */
export async function resolveCatalog(orgId: string, requestedId?: string | null, clientId?: string | null, scope?: string[] | null) {
  const limit = scope ? { clientId: { in: scope } } : {};
  if (requestedId) return db.catalog.findFirst({ where: { id: requestedId, orgId, ...limit } });
  return db.catalog.findFirst({ where: { orgId, ...(clientId ? { clientId } : limit) }, orderBy: { createdAt: 'desc' } });
}

export type DeleteOutcome = { rows: number; findings: number; cacheEntries: number; keptEvents: number };

export async function deleteCatalog(actor: Actor, catalogId: string): Promise<Result<DeleteOutcome>> {
  if (!mayWrite(actor)) return { ok: false, error: 'forbidden' };
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true, clientId: true, filename: true } });
  if (!catalog) return { ok: false, error: 'not found' };

  const items = await db.catalogItem.findMany({ where: { catalogId }, select: { rawName: true, unit: true } });
  const findings = await db.finding.count({ where: { item: { catalogId } } });
  // Cached LLM verdicts were derived from these product names; drop them for
  // every model this org has used.
  const models = await db.$queryRaw<{ model: string }[]>`
    SELECT DISTINCT model FROM rerank_cache WHERE scope = ${actor.orgId}`;
  const keys = models.flatMap(({ model }) =>
    items.map((i) => rerankCacheKey(model, normalizeName(i.rawName).matchKey, i.unit)));

  const outcome = await db.$transaction(async (tx) => {
    const kept = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM audit_event
      WHERE "orgId" = ${actor.orgId} AND ("targetId" = ${catalogId} OR payload->>'catalogId' = ${catalogId})`;
    const cacheEntries = keys.length === 0 ? 0 : await tx.$executeRaw`
      DELETE FROM rerank_cache WHERE scope = ${actor.orgId} AND key = ANY(${keys})`;
    // Items and findings go with the catalogue (ON DELETE CASCADE); audit events stay.
    await tx.catalog.delete({ where: { id: catalogId } });
    const result = { rows: items.length, findings, cacheEntries, keptEvents: Number(kept[0]?.n ?? 0) };
    await tx.auditEvent.create({
      data: {
        orgId: actor.orgId, actorId: actor.userId, action: 'catalog.deleted', targetId: catalogId,
        payload: { catalogId, clientId: catalog.clientId, filename: catalog.filename, ...result },
      },
    });
    return result;
  }, { timeout: 120_000 });

  return { ok: true, ...outcome };
}

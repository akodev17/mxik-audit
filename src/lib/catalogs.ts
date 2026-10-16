// Catalogue history and deletion, scoped by org. Deletion is the one place
// audit-log rows are removed: the user is erasing their own data, and those
// rows carry its product names. A tombstone event without product data records
// that it happened.
import { normalizeName } from '../core/normalize/index.js';
import { rerankCacheKey } from '../core/match/rerank-cache.js';
import { db } from './db.js';
import type { Actor, Result } from './decisions.js';
import { RISKY_ITEM } from './risk.js';

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
export async function listCatalogs(orgId: string, clientId?: string | null): Promise<CatalogSummary[]> {
  const catalogs = await db.catalog.findMany({
    where: { orgId, ...(clientId ? { clientId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, clientId: true, filename: true, rowCount: true, status: true, createdAt: true,
      _count: { select: { items: { where: RISKY_ITEM } } },
    },
  });
  return catalogs.map(({ _count, ...c }) => ({ ...c, riskyRows: _count.items }));
}

/**
 * The catalogue a screen should show: the requested one if it belongs to the
 * org, otherwise none; else the latest of the given client (or of the org).
 */
export async function resolveCatalog(orgId: string, requestedId?: string | null, clientId?: string | null) {
  if (requestedId) return db.catalog.findFirst({ where: { id: requestedId, orgId } });
  return db.catalog.findFirst({ where: { orgId, ...(clientId ? { clientId } : {}) }, orderBy: { createdAt: 'desc' } });
}

export type DeleteOutcome = { rows: number; findings: number; logEntries: number; cacheEntries: number };

export async function deleteCatalog(actor: Actor, catalogId: string): Promise<Result<DeleteOutcome>> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, orgId: actor.orgId }, select: { id: true } });
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
    const logEntries = await tx.$executeRaw`
      DELETE FROM audit_event
      WHERE "orgId" = ${actor.orgId}
        AND ("targetId" = ${catalogId}
          OR payload->>'catalogId' = ${catalogId}
          OR "targetId" IN (
            SELECT f.id FROM finding f JOIN catalog_item i ON i.id = f."itemId" WHERE i."catalogId" = ${catalogId}))`;
    const cacheEntries = keys.length === 0 ? 0 : await tx.$executeRaw`
      DELETE FROM rerank_cache WHERE scope = ${actor.orgId} AND key = ANY(${keys})`;
    // Items and findings go with the catalogue (ON DELETE CASCADE).
    await tx.catalog.delete({ where: { id: catalogId } });
    const result = { rows: items.length, findings, logEntries, cacheEntries };
    await tx.auditEvent.create({
      data: { orgId: actor.orgId, actorId: actor.userId, action: 'catalog.deleted', targetId: catalogId, payload: result },
    });
    return result;
  }, { timeout: 120_000 });

  return { ok: true, ...outcome };
}

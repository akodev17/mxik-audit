// Catalogue workspace data: summary counts and keyset-paged rows. The order is
// fixed (severity, least confident first, row number), so deciding a row never
// shifts the pages that have not loaded yet.
import { Prisma } from '@prisma/client';
import { db } from './db';
import { RISKY_FINDING, RISKY_ITEM } from './risk';

export const FINDING_TYPES = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY'] as const;
export type WsType = (typeof FINDING_TYPES)[number];
/** Chip filters: a finding type, markirovka, or null for all risky rows. */
export type WsSort = 'risk' | 'row';
export type WsFilter = { type: WsType | 'MARKING' | null; q: string; pendingOnly: boolean; commented: boolean; sort: WsSort };

export type WsSummary = {
  total: number;
  riskyRows: number;
  /** Risky findings, and how many of those have a decision. */
  riskyFindings: number;
  reviewed: number;
  byType: Record<string, number>;
  markingTotal: number;
  markingRisky: number;
  /** Pending findings suggested from the firm dictionary. */
  dictionaryPending: number;
};

export async function workspaceSummary(catalogId: string, rowCount: number): Promise<WsSummary> {
  const [byType, riskyRows, markingTotal, markingRisky, riskyFindings, reviewed, dictionaryPending] = await Promise.all([
    db.finding.groupBy({ by: ['type'], where: { item: { catalogId } }, _count: { _all: true } }),
    db.catalogItem.count({ where: { catalogId, ...RISKY_ITEM } }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true } }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true, ...RISKY_ITEM } }),
    db.finding.count({ where: { item: { catalogId }, ...RISKY_FINDING } }),
    db.finding.count({ where: { item: { catalogId }, ...RISKY_FINDING, decision: { not: 'pending' } } }),
    db.finding.count({ where: { item: { catalogId }, decision: 'pending', suggestedMxik: { not: null }, type: { in: ['MISSING', 'NOT_FOUND', 'MISMATCH'] }, evidence: { path: ['stage'], equals: 'dictionary' } } }),
  ]);
  return {
    total: rowCount, riskyRows, riskyFindings, reviewed, markingTotal, markingRisky, dictionaryPending,
    byType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
  };
}

export function readFilter(params: { type?: string | null; q?: string | null; pending?: string | null; comments?: string | null; sort?: string | null }): WsFilter {
  const type = params.type === 'MARKING' ? 'MARKING' : FINDING_TYPES.find((x) => x === params.type) ?? null;
  return { type, q: (params.q ?? '').trim().slice(0, 100), pendingOnly: params.pending !== '0', commented: params.comments === '1', sort: params.sort === 'row' ? 'row' : 'risk' };
}

export type Cursor = { sev: string; conf: number; row: number; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof c.sev === 'string' && typeof c.conf === 'number' && typeof c.row === 'number' && typeof c.id === 'string') return c as Cursor;
  } catch { /* malformed cursor: start over */ }
  return null;
}

function conditions(catalogId: string, filter: WsFilter): Prisma.Sql[] {
  const where: Prisma.Sql[] = [Prisma.sql`ci."catalogId" = ${catalogId}`];
  if (filter.type === 'MARKING') where.push(Prisma.sql`ci."markingRequired" = true`);
  else if (filter.type) where.push(Prisma.sql`f.type = ${filter.type}::finding_type`);
  else where.push(Prisma.sql`f.severity IN ('high'::severity, 'medium'::severity)`);
  if (filter.pendingOnly) where.push(Prisma.sql`f.decision = 'pending'::decision`);
  if (filter.commented) where.push(Prisma.sql`EXISTS (SELECT 1 FROM finding_comment fc WHERE fc."findingId" = f.id)`);
  if (filter.q) {
    const like = `%${filter.q.replace(/[\\%_]/g, '\\$&')}%`;
    const digits = /^\d{3,17}$/.test(filter.q) ? `${filter.q}%` : null;
    where.push(digits
      ? Prisma.sql`(ci."rawName" ILIKE ${like} OR ci."existingMxik" LIKE ${digits} OR f."suggestedMxik" LIKE ${digits})`
      : Prisma.sql`ci."rawName" ILIKE ${like}`);
  }
  return where;
}

type IdRow = { id: string; sev: string; conf: number; row: number };

/** ORDER BY clause: riskiest first, or in file order. */
function orderBy(sort: WsSort): Prisma.Sql {
  return sort === 'row'
    ? Prisma.sql`ci."rowIndex", f.id`
    : Prisma.sql`f.severity::text, coalesce(f.confidence, -1), ci."rowIndex", f.id`;
}

/** One page of finding ids in workspace order, plus the cursor for the next page. */
export async function workspacePageIds(
  catalogId: string, filter: WsFilter, cursor: Cursor | null, limit: number,
): Promise<{ ids: string[]; next: string | null }> {
  const where = conditions(catalogId, filter);
  if (cursor) {
    where.push(filter.sort === 'row'
      ? Prisma.sql`(ci."rowIndex", f.id) > (${cursor.row}, ${cursor.id})`
      : Prisma.sql`(f.severity::text, coalesce(f.confidence, -1), ci."rowIndex", f.id) > (${cursor.sev}, ${cursor.conf}, ${cursor.row}, ${cursor.id})`);
  }
  const rows = await db.$queryRaw<IdRow[]>(Prisma.sql`
    SELECT f.id, f.severity::text AS sev, coalesce(f.confidence, -1)::float8 AS conf, ci."rowIndex" AS row
    FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${orderBy(filter.sort)}
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next = rows.length > limit && last ? encodeCursor({ sev: last.sev, conf: last.conf, row: last.row, id: last.id }) : null;
  return { ids: page.map((r) => r.id), next };
}

/** Count for the current filter, for the "n qator" label. */
export async function workspaceCount(catalogId: string, filter: WsFilter): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*) AS n FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(conditions(catalogId, filter), ' AND ')}`);
  return Number(rows[0]?.n ?? 0);
}

/** Every finding id of a filter, in workspace order, for actions on a whole filter. */
export async function workspaceAllIds(catalogId: string, filter: WsFilter, limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT f.id FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(conditions(catalogId, filter), ' AND ')}
    ORDER BY ${orderBy(filter.sort)}
    LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

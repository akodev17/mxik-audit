// Catalogue workspace data: summary counts and keyset-paged rows. The order is
// fixed (severity rank, least confident first, row number), so deciding a row
// never shifts the pages that have not loaded yet.
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import { mergeTypeCounts } from '@tasnivo/db/finding-type';
import { catalogScope } from './access';
import { findingTypeCounts } from './finding-type-counts';
import { RISKY_FINDING, RISKY_ITEM } from './risk';
import { readCheckErrorKind, type RowFailureKind } from './row-retry';
import { sureBandSql } from './sure-band';
import { pendingSubset, type WsFilter, type WsSort } from './workspace-filter';

export { FINDING_TYPES, readFilter, type WsFilter, type WsSort, type WsType } from './workspace-filter';

export type WsSummary = {
  total: number;
  /** Catalogue rows with at least one risky finding ("qator"). */
  riskyRows: number;
  /** Risky findings ("muammo"), and how many of those have a decision. */
  riskyFindings: number;
  reviewed: number;
  byType: Record<string, number>;
  markingTotal: number;
  markingRisky: number;
  /** Pending findings suggested from the firm dictionary. */
  dictionaryPending: number;
  /** Pending high-match code suggestions: what "accept all high-match" would consider. */
  surePending: number;
  /** Rows whose check still failed after its retries: not checked, never "ok" (the FAILED filter). */
  failedRows: number;
};

export async function workspaceSummary(catalogId: string, rowCount: number): Promise<WsSummary> {
  const [byType, riskyRows, markingTotal, markingRisky, riskyFindings, reviewed, dictionaryPending, sure, failedRows] = await Promise.all([
    findingTypeCounts(catalogId),
    db.catalogItem.count({ where: { catalogId, ...RISKY_ITEM } }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true } }),
    db.catalogItem.count({ where: { catalogId, markingRequired: true, ...RISKY_ITEM } }),
    db.finding.count({ where: { item: { catalogId }, ...RISKY_FINDING } }),
    db.finding.count({ where: { item: { catalogId }, ...RISKY_FINDING, decision: { not: 'pending' } } }),
    db.finding.count({ where: { item: { catalogId }, decision: 'pending', suggestedMxik: { not: null }, type: { in: ['MISSING', 'NOT_FOUND', 'MISMATCH'] }, evidence: { path: ['stage'], equals: 'dictionary' } } }),
    db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT count(*) AS n FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
      WHERE ci."catalogId" = ${catalogId} AND ${sureBandSql()}`),
    db.catalogItem.count({ where: { catalogId, checkError: { not: null } } }),
  ]);
  return {
    total: rowCount, riskyRows, riskyFindings, reviewed, markingTotal, markingRisky, dictionaryPending, failedRows,
    surePending: Number(sure[0]?.n ?? 0),
    byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
  };
}

/** `sev` is the severity rank (0 high, 1 medium, 2 info), never the enum text, which sorts alphabetically. */
export type Cursor = { sev: number; conf: number; row: number; id: string };

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof c.sev === 'number' && typeof c.conf === 'number' && typeof c.row === 'number' && typeof c.id === 'string') return c as Cursor;
  } catch { /* malformed cursor: start over */ }
  return null;
}

const SEVERITY_RANK = Prisma.sql`(CASE f.severity WHEN 'high'::severity THEN 0 WHEN 'medium'::severity THEN 1 ELSE 2 END)`;

const RISKY_SEVERITY = Prisma.sql`f.severity IN ('high'::severity, 'medium'::severity)`;

/** WHERE parts for a filter; expects `finding f JOIN catalog_item ci`. */
export function filterConditions(catalogId: string, filter: WsFilter): Prisma.Sql[] {
  const where = scopeConditions(catalogId, filter);
  if (filter.type === 'MARKING') where.push(Prisma.sql`ci."markingRequired" = true`);
  // Findings a failed row still has (the purchase or privilege check); its rows are workspaceFailedRows.
  else if (filter.type === 'FAILED') where.push(Prisma.sql`ci."checkError" IS NOT NULL`);
  else if (filter.type) where.push(Prisma.sql`f.type = ${filter.type}::finding_type`);
  else where.push(RISKY_SEVERITY);
  return where;
}

/** Everything a filter narrows except the finding type (what the type chips choose between). */
function scopeConditions(catalogId: string, filter: WsFilter): Prisma.Sql[] {
  const where: Prisma.Sql[] = [Prisma.sql`ci."catalogId" = ${catalogId}`];
  if (filter.decision === 'pending') where.push(Prisma.sql`f.decision = 'pending'::decision`);
  else if (filter.decision === 'accepted') where.push(Prisma.sql`f.decision = 'accepted'::decision`);
  else if (filter.decision === 'rejected') where.push(Prisma.sql`f.decision = 'rejected'::decision`);
  else if (filter.decision === 'carried') where.push(Prisma.sql`f."decisionSource" = 'carry_over'`);
  else if (filter.decision === 'auto') where.push(Prisma.sql`f."decisionSource" IN ('carry_over', 'dictionary_auto')`);
  if (filter.source) where.push(Prisma.sql`f."decisionSource" = ${filter.source}`);

  if (filter.flag === 'none') where.push(Prisma.sql`f.flag IS NULL`);
  else if (filter.flag !== 'any') where.push(Prisma.sql`f.flag = ${filter.flag}`);

  if (filter.commented) where.push(Prisma.sql`EXISTS (SELECT 1 FROM finding_comment fc WHERE fc."findingId" = f.id)`);
  if (filter.q) {
    const digits = /^\d{3,17}$/.test(filter.q) ? `${filter.q}%` : null;
    const words = searchWords(filter.q).map((w) => Prisma.sql`${NAME_FOLDED} ILIKE ${`%${w.replace(/[\\%_]/g, '\\$&')}%`}`);
    const name = words.length ? Prisma.sql`(${Prisma.join(words, ' AND ')})` : Prisma.sql`true`;
    where.push(digits
      ? Prisma.sql`(${name} OR ci."existingMxik" LIKE ${digits} OR f."suggestedMxik" LIKE ${digits} OR ci.barcode LIKE ${digits})`
      : name);
  }
  return where;
}

/** The apostrophe family Uzbek text is written with (ʻ ʼ ‘ ’ ` ´ and the ASCII one). */
const APOSTROPHES = 'ʻʼ‘’`´';

/** The row name with every apostrophe folded to ASCII `'` (B1). */
const NAME_FOLDED = Prisma.sql`translate(ci."rawName", ${APOSTROPHES}, ${"'".repeat(APOSTROPHES.length)})`;

/**
 * The words of a search query with apostrophes folded to ASCII (B1): every word
 * must occur in the name, in any order, so "goʻshti", "go'shti" and "go‘shti"
 * find the same rows and "sut nestle" finds "Sut: Nestle, …".
 */
export function searchWords(q: string): string[] {
  return q.replace(new RegExp(`[${APOSTROPHES}]`, 'gu'), "'").split(/\s+/u).filter(Boolean);
}

export type ChipCounts = { all: number; byType: Record<string, number>; marking: number };

/**
 * Findings behind each type chip under the rest of the filter (decision, flag,
 * search…), so a chip's number is the count its list shows.
 */
export async function workspaceChipCounts(catalogId: string, filter: WsFilter): Promise<ChipCounts> {
  const rows = await db.$queryRaw<{ type: string; n: bigint; risky: bigint; marking: bigint }[]>(Prisma.sql`
    SELECT f.type::text AS type, count(*) AS n,
           count(*) FILTER (WHERE ${RISKY_SEVERITY}) AS risky,
           count(*) FILTER (WHERE ci."markingRequired" = true) AS marking
    FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(scopeConditions(catalogId, filter), ' AND ')}
    GROUP BY f.type`);
  return {
    all: rows.reduce((s, r) => s + Number(r.risky), 0),
    byType: Object.fromEntries(mergeTypeCounts(rows.map((r) => ({ type: r.type, count: Number(r.n) }))).map((r) => [r.type, r.count])),
    marking: rows.reduce((s, r) => s + Number(r.marking), 0),
  };
}

type IdRow = { id: string; sev: number; conf: number; row: number };

/** ORDER BY clause: riskiest first, or in file order. */
function orderBy(sort: WsSort): Prisma.Sql {
  return sort === 'row'
    ? Prisma.sql`ci."rowIndex", f.id`
    : Prisma.sql`${SEVERITY_RANK}, coalesce(f.confidence, -1), ci."rowIndex", f.id`;
}

/** One page of finding ids in workspace order, plus the cursor for the next page. */
export async function workspacePageIds(
  catalogId: string, filter: WsFilter, cursor: Cursor | null, limit: number,
): Promise<{ ids: string[]; next: string | null }> {
  const where = filterConditions(catalogId, filter);
  if (cursor) {
    where.push(filter.sort === 'row'
      ? Prisma.sql`(ci."rowIndex", f.id) > (${cursor.row}, ${cursor.id})`
      : Prisma.sql`(${SEVERITY_RANK}, coalesce(f.confidence, -1)::float8, ci."rowIndex", f.id) > (${cursor.sev}::int, ${cursor.conf}::float8, ${cursor.row}::int, ${cursor.id})`);
  }
  const rows = await db.$queryRaw<IdRow[]>(Prisma.sql`
    SELECT f.id, ${SEVERITY_RANK}::int AS sev, coalesce(f.confidence, -1)::float8 AS conf, ci."rowIndex" AS row
    FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${orderBy(filter.sort)}
    LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next = rows.length > limit && last ? encodeCursor({ sev: Number(last.sev), conf: last.conf, row: last.row, id: last.id }) : null;
  return { ids: page.map((r) => r.id), next };
}

/** Count for the current filter, for the "n muammo" label. */
export async function workspaceCount(catalogId: string, filter: WsFilter): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*) AS n FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(filterConditions(catalogId, filter), ' AND ')}`);
  return Number(rows[0]?.n ?? 0);
}

/** Pending findings of a filter: what a decision on the whole filter would touch. */
export async function workspacePendingCount(catalogId: string, filter: WsFilter): Promise<number> {
  const pending = pendingSubset(filter);
  return pending ? workspaceCount(catalogId, pending) : 0;
}

/** How many of the first `limit` findings of a filter (workspace order) have one of these types. */
export async function workspaceTypeCount(catalogId: string, filter: WsFilter, types: readonly string[], limit: number): Promise<number> {
  if (types.length === 0) return 0;
  const rows = await db.$queryRaw<{ n: bigint }[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE s.type = ANY(${[...types]})) AS n FROM (
      SELECT f.type::text AS type FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
      WHERE ${Prisma.join(filterConditions(catalogId, filter), ' AND ')}
      ORDER BY ${orderBy(filter.sort)}
      LIMIT ${limit}) s`);
  return Number(rows[0]?.n ?? 0);
}

/** Every finding id of a filter, in workspace order, for actions on a whole filter. */
export async function workspaceAllIds(catalogId: string, filter: WsFilter, limit: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT f.id FROM finding f JOIN catalog_item ci ON ci.id = f."itemId"
    WHERE ${Prisma.join(filterConditions(catalogId, filter), ' AND ')}
    ORDER BY ${orderBy(filter.sort)}
    LIMIT ${limit}`);
  return rows.map((r) => r.id);
}

/** A row the audit could not check: its kind of failure only, the raw message stays in the database and the log. */
export type FailedRow = { itemId: string; rowIndex: number; productName: string; currentMxik: string | null; kind: RowFailureKind };

export const FAILED_ROWS_LIMIT = 500;

/** The FAILED filter's rows, in file order; null when the catalogue is not the user's. */
export async function workspaceFailedRows(
  scope: { orgId: string; clientIds?: string[] | null }, catalogId: string, limit = FAILED_ROWS_LIMIT,
): Promise<{ total: number; rows: FailedRow[] } | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(scope) }, select: { id: true } });
  if (!catalog) return null;
  const where = { catalogId, checkError: { not: null } };
  const [total, items] = await Promise.all([
    db.catalogItem.count({ where }),
    db.catalogItem.findMany({
      where, orderBy: { rowIndex: 'asc' }, take: limit,
      select: { id: true, rowIndex: true, rawName: true, existingMxik: true, checkError: true },
    }),
  ]);
  return {
    total,
    rows: items.map((i) => ({
      itemId: i.id, rowIndex: i.rowIndex, productName: i.rawName, currentMxik: i.existingMxik, kind: readCheckErrorKind(i.checkError ?? ''),
    })),
  };
}

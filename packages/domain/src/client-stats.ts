// Per-client numbers from each client's latest audited catalogue, in one query.
// A risky row is "open" while it still has a pending high or medium finding;
// progress is counted in rows, so a row with two findings is one row to review.
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import { localDate } from './reminder-dates';

export type ClientStats = {
  id: string;
  name: string;
  isDefault: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  /** Latest catalogue with a finished audit; null when none. */
  catalogId: string | null;
  catalogName: string | null;
  auditedAt: Date | null;
  rowCount: number;
  previousId: string | null;
  /** Every catalogue of the client, audited or not. */
  catalogs: number;
  riskyRows: number;
  openRows: number;
  riskyFindings: number;
  pendingFindings: number;
  /** Pending risky findings raised by a classifier update. */
  updatePending: number;
  overdueTasks: number;
  /** Emails of the accountants assigned to the client. */
  accountants: string[];
};

export const CLIENT_FILTERS = ['all', 'attention', 'overdue', 'stale', 'empty', 'archived'] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];
export const CLIENT_SORTS = ['attention', 'name', 'open', 'progress', 'oldest', 'newest'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];
export const STALE_DAYS = [30, 60, 90] as const;

export type StatsQuery = {
  orgId: string;
  /** Clients the caller may see; null = every client of the org. */
  clientIds: string[] | null;
  search?: string;
  filter?: ClientFilter;
  staleDays?: number;
  sort?: ClientSort;
  limit?: number;
  offset?: number;
  now?: Date;
};

export type FilterCounts = Record<ClientFilter, number>;
export type StatsPage = { rows: ClientStats[]; total: number; counts: FilterCounts };

/** Why a client needs attention; the default client is never flagged just for having no catalogue. */
export type Reason = { kind: 'update' | 'open' | 'overdue' | 'empty'; count: number };

export function attentionReasons(c: Pick<ClientStats, 'catalogId' | 'isDefault' | 'openRows' | 'updatePending' | 'overdueTasks'>): Reason[] {
  const reasons: Reason[] = [];
  if (!c.catalogId && !c.isDefault) reasons.push({ kind: 'empty', count: 0 });
  if (c.updatePending > 0) reasons.push({ kind: 'update', count: c.updatePending });
  if (c.openRows > 0) reasons.push({ kind: 'open', count: c.openRows });
  if (c.overdueTasks > 0) reasons.push({ kind: 'overdue', count: c.overdueTasks });
  return reasons;
}

// Pure, so pages that read through the API use it too (client-kpi has no database).
export { rowProgress } from './client-kpi';

const ATTENTION = Prisma.sql`(open_rows > 0 OR update_pending > 0 OR overdue_tasks > 0 OR (catalog_id IS NULL AND NOT is_default))`;

const ORDER: Record<ClientSort, Prisma.Sql> = {
  attention: Prisma.sql`(CASE WHEN ${ATTENTION} THEN 0 ELSE 1 END), open_rows DESC, overdue_tasks DESC, name ASC, id ASC`,
  name: Prisma.sql`name ASC, id ASC`,
  open: Prisma.sql`open_rows DESC, name ASC, id ASC`,
  progress: Prisma.sql`(CASE WHEN risky_rows = 0 THEN 2 ELSE (risky_rows - open_rows)::float / risky_rows END) ASC, open_rows DESC, name ASC, id ASC`,
  oldest: Prisma.sql`audited_at ASC NULLS FIRST, name ASC, id ASC`,
  newest: Prisma.sql`audited_at DESC NULLS LAST, name ASC, id ASC`,
};

type Raw = {
  id: string | null; name: string; is_default: boolean; archived_at: Date | null; created_at: Date;
  catalog_id: string | null; catalog_name: string | null; audited_at: Date | null; row_count: number | null; previous_id: string | null;
  catalogs: number; risky_rows: number; open_rows: number; risky_findings: number; pending_findings: number; update_pending: number;
  overdue_tasks: number; accountants: string[] | null;
  n_all: number; n_attention: number; n_overdue: number; n_stale: number; n_empty: number; n_archived: number; n_current: number;
};

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

/** One page of clients with their numbers, plus how many clients each filter would show. */
export async function clientStats(q: StatsQuery): Promise<StatsPage> {
  const now = q.now ?? new Date();
  const today = localDate(now).date;
  const filter = q.filter ?? 'all';
  const staleBefore = new Date(now.getTime() - (q.staleDays ?? STALE_DAYS[0]) * 86_400_000);
  const where: Prisma.Sql[] = [Prisma.sql`cl."orgId" = ${q.orgId}`];
  if (q.clientIds) where.push(Prisma.sql`cl.id = ANY(${q.clientIds})`);
  const search = (q.search ?? '').trim().slice(0, 100);
  if (search) where.push(Prisma.sql`cl.name ILIKE ${`%${escapeLike(search)}%`}`);

  const stale = Prisma.sql`(audited_at IS NOT NULL AND audited_at < ${staleBefore})`;
  const pick: Record<ClientFilter, Prisma.Sql> = {
    all: Prisma.sql`NOT archived`,
    attention: Prisma.sql`NOT archived AND ${ATTENTION}`,
    overdue: Prisma.sql`NOT archived AND overdue_tasks > 0`,
    stale: Prisma.sql`NOT archived AND ${stale}`,
    empty: Prisma.sql`NOT archived AND catalog_id IS NULL`,
    archived: Prisma.sql`archived`,
  };

  const rows = await db.$queryRaw<Raw[]>(Prisma.sql`
    WITH base AS (
      SELECT cl.id, cl.name, cl."isDefault" AS is_default, cl."archivedAt" AS archived_at, cl."archivedAt" IS NOT NULL AS archived,
        cl."createdAt" AS created_at,
        l.id AS catalog_id, l.filename AS catalog_name, l."createdAt" AS audited_at, l."rowCount" AS row_count, l."previousId" AS previous_id,
        (SELECT count(*)::int FROM catalog k WHERE k."clientId" = cl.id) AS catalogs,
        coalesce(s.risky_rows, 0)::int AS risky_rows,
        coalesce(s.open_rows, 0)::int AS open_rows,
        coalesce(s.risky_findings, 0)::int AS risky_findings,
        coalesce(s.pending_findings, 0)::int AS pending_findings,
        coalesce(s.update_pending, 0)::int AS update_pending,
        (SELECT count(*)::int FROM reminder_task t WHERE t."clientId" = cl.id AND t."doneAt" IS NULL AND t."dueOn" < ${today}) AS overdue_tasks,
        ARRAY(
          SELECT u.email FROM client_assignment ca JOIN "user" u ON u.id = ca."userId"
          WHERE ca."clientId" = cl.id AND u."orgId" = cl."orgId" AND u.role = 'accountant'::user_role ORDER BY u.email
        ) AS accountants
      FROM client cl
      LEFT JOIN LATERAL (
        SELECT k.id, k.filename, k."createdAt", k."rowCount", k."previousId" FROM catalog k
        WHERE k."clientId" = cl.id AND k.status = 'ready'::catalog_status
        ORDER BY k."createdAt" DESC, k.id DESC LIMIT 1
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT i.id) AS risky_rows,
          count(DISTINCT i.id) FILTER (WHERE f.decision = 'pending'::decision) AS open_rows,
          count(*) AS risky_findings,
          count(*) FILTER (WHERE f.decision = 'pending'::decision) AS pending_findings,
          count(*) FILTER (WHERE f.decision = 'pending'::decision AND f."snapshotId" IS NOT NULL) AS update_pending
        FROM catalog_item i JOIN finding f ON f."itemId" = i.id
        WHERE i."catalogId" = l.id AND f.severity IN ('high'::severity, 'medium'::severity)
      ) s ON true
      WHERE ${Prisma.join(where, ' AND ')}
    ), counts AS (
      SELECT
        count(*) FILTER (WHERE ${pick.all})::int AS n_all,
        count(*) FILTER (WHERE ${pick.attention})::int AS n_attention,
        count(*) FILTER (WHERE ${pick.overdue})::int AS n_overdue,
        count(*) FILTER (WHERE ${pick.stale})::int AS n_stale,
        count(*) FILTER (WHERE ${pick.empty})::int AS n_empty,
        count(*) FILTER (WHERE ${pick.archived})::int AS n_archived,
        count(*) FILTER (WHERE ${pick[filter]})::int AS n_current
      FROM base
    )
    SELECT p.*, counts.* FROM counts
    LEFT JOIN LATERAL (
      SELECT * FROM base WHERE ${pick[filter]}
      ORDER BY ${ORDER[q.sort ?? 'attention']}
      LIMIT ${q.limit ?? 50} OFFSET ${Math.max(0, q.offset ?? 0)}
    ) p ON true`);

  const head = rows[0];
  const counts: FilterCounts = {
    all: head?.n_all ?? 0, attention: head?.n_attention ?? 0, overdue: head?.n_overdue ?? 0,
    stale: head?.n_stale ?? 0, empty: head?.n_empty ?? 0, archived: head?.n_archived ?? 0,
  };
  return {
    total: head?.n_current ?? 0,
    counts,
    rows: rows.flatMap((r): ClientStats[] => (r.id === null ? [] : [{
      id: r.id, name: r.name, isDefault: r.is_default, archivedAt: r.archived_at, createdAt: r.created_at,
      catalogId: r.catalog_id, catalogName: r.catalog_name, auditedAt: r.audited_at, rowCount: r.row_count ?? 0, previousId: r.previous_id,
      catalogs: r.catalogs, riskyRows: r.risky_rows, openRows: r.open_rows, riskyFindings: r.risky_findings,
      pendingFindings: r.pending_findings, updatePending: r.update_pending, overdueTasks: r.overdue_tasks, accountants: r.accountants ?? [],
    }])),
  };
}

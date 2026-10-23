// The activity log: AuditEvent rows with filters. An accountant sees only the
// events of the clients they may open; org-level events (team, billing,
// security) are for admins, except a person's own.
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';

export const CATEGORIES = ['all', 'decisions', 'uploads', 'exports', 'share', 'clients', 'team', 'classifier', 'dictionary', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Every action the app writes belongs to one group; 'other' only catches what a future change forgets. */
export const GROUPS: Record<Exclude<Category, 'all' | 'other'>, readonly string[]> = {
  decisions: ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected', 'finding.undone', 'finding.carried_over', 'finding.auto_accepted', 'finding.flagged', 'finding.flag_undone', 'finding.commented', 'finding.split_from_group', 'item.name_filled', 'suggestion.reported_wrong'],
  uploads: [
    'catalog.uploaded', 'catalog.audited', 'catalog.deleted', 'catalog.upload_discarded',
    'purchases.uploaded', 'purchases.mapped', 'purchases.deleted',
    'sales.uploaded', 'sales.checked', 'sales.deleted', 'cheques.uploaded', 'cheques.checked', 'cheques.deleted',
  ],
  exports: ['catalog.exported', 'catalog.pdf_exported', 'catalog.report_csv_exported', 'account.exported'],
  share: ['share.created', 'share.revoked'],
  clients: ['client.created', 'client.renamed', 'client.archived', 'client.restored', 'client.deleted', 'client.accountants_set', 'client.activity_set', 'schedule.set', 'reminder.sent', 'reminder.done', 'review.assigned', 'review.completed'],
  team: [
    'team.invited', 'team.invite_revoked', 'team.joined', 'team.updated', 'team.removed', 'account.created', 'demo.started', 'apikey.created', 'apikey.revoked',
    'security.2fa_enabled', 'security.2fa_disabled', 'security.session_revoked', 'security.password_changed', 'security.password_reset', 'security.telegram_bound', 'security.telegram_unbound',
    'telegram.linked', 'telegram.unlinked', 'account.deletion_requested', 'account.restored', 'retention.changed', 'retention.purged', 'billing.order_created', 'billing.paid',
  ],
  classifier: ['classifier.updated'],
  dictionary: ['dictionary.edited', 'dictionary.deleted', 'dictionary.auto_accept'],
};
const KNOWN = Object.values(GROUPS).flat();

/** Events about the org itself rather than a client; only admins read other people's. */
const ORG_LEVEL = [...GROUPS.team, 'team.invite_revoked', 'billing.paid', 'billing.order_created', 'dictionary.auto_accept', 'account.exported', 'retention.changed', 'retention.purged'];


export type ActivityFilter = { clientId: string | null; userId: string | null; category: Category; from: string | null; to: string | null; page: number };

export type ActivityRow = {
  id: string; action: string; at: Date;
  actorId: string | null; actor: string | null;
  catalogId: string | null; catalogName: string | null;
  /** The event points at a catalogue that has since been deleted. */
  catalogDeleted: boolean;
  clientId: string | null; clientName: string | null;
  count: number | null;
  /** Product name of a single-row decision, when the event recorded it. */
  product: string | null;
};

export type ActivityViewer = { orgId: string; userId: string; role: string; clientIds?: string[] | null };

export const PAGE_SIZE = 50;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Start of a Tashkent calendar day (UTC+5, no daylight saving) as an instant; null for a malformed day. */
export function tashkentDayStart(day: string | null): Date | null {
  if (!day || !ISO_DAY.test(day)) return null;
  const d = new Date(`${day}T00:00:00+05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type Raw = {
  id: string; action: string; at: Date; actor_id: string | null; email: string | null;
  catalog_id: string | null; catalog_name: string | null; catalog_exists: boolean;
  client_id: string | null; client_name: string | null; count: string | null; product: string | null;
};

const catalogOf = Prisma.sql`COALESCE(e.payload->>'catalogId', CASE WHEN e.action LIKE 'catalog.%' THEN e."targetId" END)`;

/**
 * A `catalog.uploaded` event is written when the file is read, before the user confirms the columns (B19).
 * One whose catalogue is still a draft, or was discarded, never became a catalogue: shown as
 * `catalog.previewed` ("file read"), and left out of the dashboard and client summaries.
 */
const NEVER_COMMITTED = Prisma.sql`(e.action = 'catalog.uploaded' AND (
  EXISTS (SELECT 1 FROM catalog p WHERE p.id = e."targetId" AND p."orgId" = e."orgId" AND p.status = 'uploaded')
  OR EXISTS (SELECT 1 FROM audit_event d WHERE d."orgId" = e."orgId" AND d.action = 'catalog.upload_discarded' AND d."targetId" = e."targetId")))`;

/** The product of a single-row event: named in the payload, or the one finding an undo lists (B19). */
const productOf = Prisma.sql`COALESCE(e.payload->>'productName', CASE WHEN jsonb_typeof(e.payload->'findings') = 'array' THEN
  CASE WHEN jsonb_array_length(e.payload->'findings') = 1 THEN e.payload->'findings'->0->>'productName' END END)`;

function conditions(user: ActivityViewer, f: ActivityFilter, committedOnly = false): Prisma.Sql[] {
  const where: Prisma.Sql[] = [Prisma.sql`e."orgId" = ${user.orgId}`, Prisma.sql`e.action <> 'user.signed_in'`];
  if (committedOnly) where.push(Prisma.sql`NOT ${NEVER_COMMITTED}`, Prisma.sql`e.action <> 'catalog.upload_discarded'`);
  if (f.category !== 'all') {
    where.push(f.category === 'other'
      ? Prisma.sql`NOT (e.action = ANY(${KNOWN}))`
      : Prisma.sql`e.action = ANY(${GROUPS[f.category]})`);
  }
  if (f.userId) where.push(Prisma.sql`e."actorId" = ${f.userId}`);
  const from = tashkentDayStart(f.from);
  const to = tashkentDayStart(f.to);
  if (from) where.push(Prisma.sql`e."createdAt" >= ${from}`);
  if (to) where.push(Prisma.sql`e."createdAt" < ${new Date(to.getTime() + 86_400_000)}`);

  // A client filter never reaches past the user's own scope.
  const scope = user.clientIds ?? null;
  const clients = f.clientId ? (scope && !scope.includes(f.clientId) ? [] : [f.clientId]) : scope;
  if (clients) {
    where.push(Prisma.sql`(
      e.payload->>'clientId' = ANY(${clients})
      OR ${catalogOf} IN (SELECT id FROM catalog WHERE "orgId" = ${user.orgId} AND "clientId" = ANY(${clients}))
      OR ${catalogOf} IN (
        SELECT t."targetId" FROM audit_event t
        WHERE t."orgId" = ${user.orgId} AND t.action = 'catalog.deleted' AND t.payload->>'clientId' = ANY(${clients})))`);
  }
  if (user.role !== 'admin') where.push(Prisma.sql`(NOT (e.action = ANY(${ORG_LEVEL})) OR e."actorId" = ${user.userId})`);
  return where;
}

/** One page of the log, newest first, with the number of matching events. */
export async function activityPage(
  user: ActivityViewer, f: ActivityFilter,
  /** committedOnly: leave out uploads that never became catalogues (the dashboard and client summaries). */
  opts: { pageSize?: number; withTotal?: boolean; committedOnly?: boolean } = {},
): Promise<{ rows: ActivityRow[]; hasMore: boolean; total: number | null; pageSize: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? PAGE_SIZE, 1), 200);
  const where = Prisma.join(conditions(user, f, opts.committedOnly), ' AND ');
  const [rows, counted] = await Promise.all([
    db.$queryRaw<Raw[]>(Prisma.sql`
      SELECT e.id, CASE WHEN ${NEVER_COMMITTED} THEN 'catalog.previewed' ELSE e.action END AS action, e."createdAt" AS at, e."actorId" AS actor_id, u.email, ${catalogOf} AS catalog_id,
        c.filename AS catalog_name, c.id IS NOT NULL AS catalog_exists,
        cl.id AS client_id,
        COALESCE(cl.name, CASE WHEN e.action LIKE 'client.%' THEN e.payload->>'name' END) AS client_name,
        e.payload->>'count' AS count, ${productOf} AS product
      FROM audit_event e
        LEFT JOIN "user" u ON u.id = e."actorId" AND u."orgId" = e."orgId"
        LEFT JOIN catalog c ON c.id = ${catalogOf} AND c."orgId" = e."orgId"
        LEFT JOIN client cl ON cl.id = COALESCE(c."clientId", e.payload->>'clientId') AND cl."orgId" = e."orgId"
      WHERE ${where}
      ORDER BY e."createdAt" DESC, e.id DESC
      LIMIT ${pageSize + 1} OFFSET ${Math.max(0, f.page) * pageSize}`),
    opts.withTotal
      ? db.$queryRaw<{ n: bigint }[]>(Prisma.sql`SELECT count(*) AS n FROM audit_event e WHERE ${where}`)
      : Promise.resolve(null),
  ]);

  const page = rows.slice(0, pageSize);
  const gone = await deletedCatalogs(user.orgId, page.flatMap((r) => (r.catalog_id && !r.catalog_exists ? [r.catalog_id] : [])));
  return {
    pageSize,
    hasMore: rows.length > pageSize,
    total: counted ? Number(counted[0]?.n ?? 0) : null,
    rows: page.map((r) => {
      const tomb = r.catalog_id && !r.catalog_exists ? gone.get(r.catalog_id) : undefined;
      return {
        id: r.id, action: r.action, at: r.at, actorId: r.actor_id, actor: r.email,
        catalogId: r.catalog_exists ? r.catalog_id : null,
        catalogName: r.catalog_name ?? tomb?.filename ?? null,
        catalogDeleted: Boolean(r.catalog_id && !r.catalog_exists && (tomb || r.action === 'catalog.deleted')),
        clientId: r.client_id ?? (tomb?.clientName ? tomb.clientId : null),
        clientName: r.client_name ?? tomb?.clientName ?? null,
        count: r.count && /^\d+$/.test(r.count) ? Number(r.count) : null,
        product: r.product,
      };
    }),
  };
}

type Tombstone = { filename: string | null; clientId: string | null; clientName: string | null };

/** File and client names of deleted catalogues, from their deletion events. */
async function deletedCatalogs(orgId: string, ids: string[]): Promise<Map<string, Tombstone>> {
  if (ids.length === 0) return new Map();
  const events = await db.auditEvent.findMany({
    where: { orgId, action: 'catalog.deleted', targetId: { in: [...new Set(ids)] } },
    select: { targetId: true, payload: true },
  });
  const read = (p: unknown, key: string): string | null => {
    const v = typeof p === 'object' && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>)[key] : null;
    return typeof v === 'string' ? v : null;
  };
  const clientIds = events.flatMap((e) => { const id = read(e.payload, 'clientId'); return id ? [id] : []; });
  const clients = clientIds.length === 0 ? [] : await db.client.findMany({ where: { orgId, id: { in: clientIds } }, select: { id: true, name: true } });
  const names = new Map(clients.map((c) => [c.id, c.name]));
  return new Map(events.flatMap((e) => {
    if (!e.targetId) return [];
    const clientId = read(e.payload, 'clientId');
    return [[e.targetId, { filename: read(e.payload, 'filename'), clientId, clientName: clientId ? names.get(clientId) ?? null : null }] as const];
  }));
}

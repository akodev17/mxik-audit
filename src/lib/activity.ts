// The activity log: AuditEvent rows with filters. An accountant sees only the
// events of the clients they may open; org-level events (team, billing) are for admins.
import { Prisma } from '@prisma/client';
import { db } from './db';

export const CATEGORIES = ['all', 'decisions', 'uploads', 'exports', 'share', 'team', 'classifier', 'dictionary', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

const GROUPS: Record<Exclude<Category, 'all' | 'other'>, string[]> = {
  decisions: ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected', 'finding.undone', 'finding.carried_over', 'finding.flagged', 'finding.commented', 'finding.split_from_group', 'suggestion.reported_wrong'],
  uploads: ['catalog.uploaded', 'catalog.audited', 'catalog.deleted', 'purchases.uploaded', 'sales.uploaded', 'cheques.uploaded', 'sales.checked', 'cheques.checked'],
  exports: ['catalog.exported', 'catalog.pdf_exported', 'account.exported'],
  share: ['share.created', 'share.revoked'],
  team: ['team.invited', 'team.joined', 'team.updated', 'team.removed', 'account.created', 'apikey.created', 'apikey.revoked', 'security.2fa_enabled', 'security.2fa_disabled', 'security.session_revoked'],
  classifier: ['classifier.updated'],
  dictionary: ['dictionary.edited', 'dictionary.deleted', 'dictionary.auto_accept'],
};
const KNOWN = Object.values(GROUPS).flat();
/** Events about the org itself rather than a client; only admins read them. */
const ORG_LEVEL = new Set(['team.invited', 'team.joined', 'team.updated', 'team.removed', 'billing.paid', 'billing.order_created', 'dictionary.auto_accept', 'account.created', 'apikey.created', 'apikey.revoked']);

export type ActivityFilter = { clientId: string | null; userId: string | null; category: Category; from: string | null; to: string | null; page: number };

export type ActivityRow = {
  id: string; action: string; at: Date; actor: string | null;
  catalogId: string | null; catalogName: string | null; clientName: string | null; count: number | null;
};

const PAGE_SIZE = 50;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Raw = { id: string; action: string; at: Date; email: string | null; catalog_id: string | null; catalog_name: string | null; client_name: string | null; count: string | null };

export async function activityPage(
  user: { orgId: string; role: string; clientIds?: string[] | null }, f: ActivityFilter,
): Promise<{ rows: ActivityRow[]; hasMore: boolean }> {
  // The catalogues an event can point at, through its payload or its target.
  const catalogOf = Prisma.sql`COALESCE(e.payload->>'catalogId', CASE WHEN e.action LIKE 'catalog.%' THEN e."targetId" END)`;
  const where: Prisma.Sql[] = [Prisma.sql`e."orgId" = ${user.orgId}`, Prisma.sql`e.action <> 'user.signed_in'`];

  if (f.category !== 'all') {
    where.push(f.category === 'other'
      ? Prisma.sql`NOT (e.action = ANY(${KNOWN}))`
      : Prisma.sql`e.action = ANY(${GROUPS[f.category]})`);
  }
  if (f.userId) where.push(Prisma.sql`e."actorId" = ${f.userId}`);
  if (f.from && ISO_DAY.test(f.from)) where.push(Prisma.sql`e."createdAt" >= ${new Date(`${f.from}T00:00:00Z`)}`);
  if (f.to && ISO_DAY.test(f.to)) where.push(Prisma.sql`e."createdAt" < ${new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000)}`);

  const clients = f.clientId ? [f.clientId] : user.clientIds ?? null;
  if (clients) {
    where.push(Prisma.sql`(e.payload->>'clientId' = ANY(${clients}) OR ${catalogOf} IN (SELECT id FROM catalog WHERE "clientId" = ANY(${clients})))`);
  }
  if (user.role !== 'admin') where.push(Prisma.sql`NOT (e.action = ANY(${[...ORG_LEVEL]}))`);

  const rows = await db.$queryRaw<Raw[]>(Prisma.sql`
    SELECT e.id, e.action, e."createdAt" AS at, u.email, ${catalogOf} AS catalog_id,
      c.filename AS catalog_name, cl.name AS client_name, e.payload->>'count' AS count
    FROM audit_event e
      LEFT JOIN "user" u ON u.id = e."actorId"
      LEFT JOIN catalog c ON c.id = ${catalogOf} AND c."orgId" = e."orgId"
      LEFT JOIN client cl ON cl.id = c."clientId"
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY e."createdAt" DESC, e.id DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${Math.max(0, f.page) * PAGE_SIZE}`);

  return {
    hasMore: rows.length > PAGE_SIZE,
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id, action: r.action, at: r.at, actor: r.email, catalogId: r.catalog_id && r.catalog_name ? r.catalog_id : null,
      catalogName: r.catalog_name, clientName: r.client_name, count: r.count && /^\d+$/.test(r.count) ? Number(r.count) : null,
    })),
  };
}

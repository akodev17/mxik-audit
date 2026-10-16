// Numbers for the firm dashboard: per client, from its latest ready catalogue.
import { Prisma } from '@prisma/client';
import { clientScope } from './access';
import { db } from './db';
import { overdueClientIds } from './reminders';

export type ClientCard = {
  id: string;
  name: string;
  catalogId: string | null;
  catalogName: string | null;
  catalogDate: Date | null;
  riskyRows: number;
  riskyFindings: number;
  reviewed: number;
  /** Findings recorded by a classifier update that nobody has decided yet. */
  updatePending: number;
  accountants: string[];
  overdue: boolean;
  /** Why this client needs attention; empty when it does not. */
  reasons: { kind: 'update' | 'unreviewed' | 'overdue' | 'empty'; count: number }[];
};

export type Dashboard = {
  cards: ClientCard[];
  totals: { clients: number; riskyRows: number; riskyFindings: number; reviewed: number; attention: number };
  accountants: { id: string; email: string }[];
};

type Agg = { catalog_id: string; risky_rows: bigint; risky: bigint; reviewed: bigint; update_pending: bigint };

export async function dashboard(
  user: { orgId: string; clientIds?: string[] | null }, accountantId: string | null,
): Promise<Dashboard> {
  const accountants = await db.user.findMany({ where: { orgId: user.orgId, role: { not: 'viewer' } }, orderBy: { email: 'asc' }, select: { id: true, email: true, assignments: { select: { clientId: true } } } });
  const assignedTo = new Map<string, string[]>();
  for (const a of accountants) for (const c of a.assignments) assignedTo.set(c.clientId, [...(assignedTo.get(c.clientId) ?? []), a.email]);

  const wanted = accountantId ? accountants.find((a) => a.id === accountantId)?.assignments.map((a) => a.clientId) ?? [] : null;
  const clients = await db.client.findMany({
    where: { orgId: user.orgId, ...clientScope(user), ...(wanted ? { id: { in: wanted } } : {}) },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true,
      catalogs: { where: { status: 'ready' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, filename: true, createdAt: true } },
    },
  });
  const catalogIds = clients.flatMap((c) => (c.catalogs[0] ? [c.catalogs[0].id] : []));
  const rows = catalogIds.length === 0 ? [] : await db.$queryRaw<Agg[]>(Prisma.sql`
    SELECT c.id AS catalog_id,
      count(DISTINCT i.id) FILTER (WHERE f.severity IN ('high'::severity, 'medium'::severity)) AS risky_rows,
      count(*) FILTER (WHERE f.severity IN ('high'::severity, 'medium'::severity)) AS risky,
      count(*) FILTER (WHERE f.severity IN ('high'::severity, 'medium'::severity) AND f.decision <> 'pending'::decision) AS reviewed,
      count(*) FILTER (WHERE f.severity IN ('high'::severity, 'medium'::severity) AND f."snapshotId" IS NOT NULL AND f.decision = 'pending'::decision) AS update_pending
    FROM finding f JOIN catalog_item i ON i.id = f."itemId" JOIN catalog c ON c.id = i."catalogId"
    WHERE c.id = ANY(${catalogIds}) GROUP BY c.id`);
  const agg = new Map(rows.map((r) => [r.catalog_id, r]));
  const overdue = await overdueClientIds(user.orgId);

  const cards = clients.map((c): ClientCard => {
    const catalog = c.catalogs[0];
    const a = catalog ? agg.get(catalog.id) : undefined;
    const riskyFindings = Number(a?.risky ?? 0);
    const reviewed = Number(a?.reviewed ?? 0);
    const updatePending = Number(a?.update_pending ?? 0);
    const isOverdue = overdue.has(c.id);
    const reasons: ClientCard['reasons'] = [];
    if (!catalog) reasons.push({ kind: 'empty', count: 0 });
    if (updatePending > 0) reasons.push({ kind: 'update', count: updatePending });
    if (riskyFindings - reviewed > 0) reasons.push({ kind: 'unreviewed', count: riskyFindings - reviewed });
    if (isOverdue) reasons.push({ kind: 'overdue', count: 0 });
    return {
      id: c.id, name: c.name, catalogId: catalog?.id ?? null, catalogName: catalog?.filename ?? null, catalogDate: catalog?.createdAt ?? null,
      riskyRows: Number(a?.risky_rows ?? 0), riskyFindings, reviewed, updatePending,
      accountants: assignedTo.get(c.id) ?? [], overdue: isOverdue, reasons,
    };
  });
  const sum = (pick: (c: ClientCard) => number): number => cards.reduce((n, c) => n + pick(c), 0);
  return {
    cards,
    totals: { clients: cards.length, riskyRows: sum((c) => c.riskyRows), riskyFindings: sum((c) => c.riskyFindings), reviewed: sum((c) => c.reviewed), attention: cards.filter((c) => c.reasons.length > 0).length },
    accountants: accountants.map((a) => ({ id: a.id, email: a.email })),
  };
}

export type ActivityItem = { id: string; action: string; actor: string | null; at: Date; payload: Record<string, unknown> };

/** The org's latest audit events, newest first. */
export async function recentActivity(orgId: string, limit = 12): Promise<ActivityItem[]> {
  const events = await db.auditEvent.findMany({ where: { orgId, action: { not: 'user.signed_in' } }, orderBy: { createdAt: 'desc' }, take: limit });
  const actors = await db.user.findMany({ where: { id: { in: events.flatMap((e) => (e.actorId ? [e.actorId] : [])) }, orgId }, select: { id: true, email: true } });
  const email = new Map(actors.map((a) => [a.id, a.email]));
  return events.map((e) => ({
    id: e.id, action: e.action, actor: e.actorId ? email.get(e.actorId) ?? null : null, at: e.createdAt,
    payload: typeof e.payload === 'object' && e.payload !== null && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : {},
  }));
}

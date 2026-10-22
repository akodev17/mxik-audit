// The firm dashboard: what needs attention across the clients a user may see,
// from each client's latest audited catalogue. Open risky rows (rows with a
// pending high or medium finding) are the unit of work; findings are shown
// alongside, never mixed with them.
import { Prisma } from '@prisma/client';
import { attentionReasons, clientStats, type ClientStats } from './client-stats';
import { db } from './db';
import { readFindingType } from './finding-type';

export type Totals = {
  clients: number;
  riskyRows: number;
  openRows: number;
  pendingFindings: number;
  updatePending: number;
  attention: number;
  overdueTasks: number;
  noCatalog: number;
};

/** Sums over the clients shown; the default client without a catalogue is not counted as missing one. */
export function dashboardTotals(stats: readonly ClientStats[]): Totals {
  const sum = (pick: (c: ClientStats) => number): number => stats.reduce((n, c) => n + pick(c), 0);
  return {
    clients: stats.length,
    riskyRows: sum((c) => c.riskyRows),
    openRows: sum((c) => c.openRows),
    pendingFindings: sum((c) => c.pendingFindings),
    updatePending: sum((c) => c.updatePending),
    attention: stats.filter((c) => attentionReasons(c).length > 0).length,
    overdueTasks: sum((c) => c.overdueTasks),
    noCatalog: stats.filter((c) => !c.catalogId && !c.isDefault).length,
  };
}

export type TypeCount = { type: string; findings: number; rows: number };

/** Pending risky findings by check, most frequent first. */
export async function pendingByType(catalogIds: string[]): Promise<TypeCount[]> {
  if (catalogIds.length === 0) return [];
  const rows = await db.$queryRaw<{ type: string; findings: number; rows: number }[]>(Prisma.sql`
    SELECT f.type::text AS type, count(*)::int AS findings, count(DISTINCT f."itemId")::int AS rows
    FROM finding f JOIN catalog_item i ON i.id = f."itemId"
    WHERE i."catalogId" = ANY(${catalogIds}) AND f.decision = 'pending'::decision AND f.severity IN ('high'::severity, 'medium'::severity)
    GROUP BY f.type ORDER BY findings DESC, type ASC`);
  // A type this build does not know is one OTHER entry, after the known ones.
  const known = rows.filter((r) => readFindingType(r.type) !== 'OTHER');
  const other = rows.filter((r) => readFindingType(r.type) === 'OTHER');
  if (other.length === 0) return rows;
  return [...known, { type: 'OTHER', findings: other.reduce((n, r) => n + r.findings, 0), rows: other.reduce((n, r) => n + r.rows, 0) }];
}

export type Change = {
  clientId: string; clientName: string; catalogId: string; auditedAt: Date;
  /** Risky rows in the version this catalogue replaced, and now. */
  before: number; after: number;
};

/** Clients whose latest audit replaced an earlier version: risky rows then and now, latest audits first. */
export async function changesSincePrevious(orgId: string, stats: readonly ClientStats[], limit = 6): Promise<Change[]> {
  const withPrevious = stats.filter((c): c is ClientStats & { catalogId: string; previousId: string; auditedAt: Date } =>
    c.catalogId !== null && c.previousId !== null && c.auditedAt !== null);
  if (withPrevious.length === 0) return [];
  const prevIds = withPrevious.map((c) => c.previousId);
  const rows = await db.$queryRaw<{ id: string; risky: number }[]>(Prisma.sql`
    SELECT k.id, (SELECT count(DISTINCT i.id)::int FROM catalog_item i JOIN finding f ON f."itemId" = i.id
                  WHERE i."catalogId" = k.id AND f.severity IN ('high'::severity, 'medium'::severity)) AS risky
    FROM catalog k WHERE k.id = ANY(${prevIds}) AND k."orgId" = ${orgId} AND k.status = 'ready'::catalog_status`);
  const before = new Map(rows.map((r) => [r.id, r.risky]));
  return withPrevious
    .flatMap((c) => {
      const prev = before.get(c.previousId);
      return prev === undefined ? [] : [{ clientId: c.id, clientName: c.name, catalogId: c.catalogId, auditedAt: c.auditedAt, before: prev, after: c.riskyRows }];
    })
    .sort((a, b) => b.auditedAt.getTime() - a.auditedAt.getTime())
    .slice(0, limit);
}

export type AccountantOption = { id: string; email: string; assigned: number };

/** Accountants for the dashboard filter (admins and viewers left out); assigned 0 = works on every client. */
export async function accountantOptions(orgId: string): Promise<(AccountantOption & { clientIds: string[] })[]> {
  const people = await db.user.findMany({
    where: { orgId, role: 'accountant' },
    orderBy: { email: 'asc' },
    select: { id: true, email: true, assignments: { select: { clientId: true } } },
  });
  return people.map((p) => ({ id: p.id, email: p.email, assigned: p.assignments.length, clientIds: p.assignments.map((a) => a.clientId) }));
}

export type WorkloadRow = {
  userId: string;
  email: string;
  /** Null = no assignments, so every client. */
  assigned: number | null;
  clients: number;
  openRows: number;
  pendingFindings: number;
  overdueTasks: number;
  lastDecisionAt: Date | null;
};

const PERSONAL_DECISIONS = ['finding.accepted', 'finding.rejected', 'finding.bulk_accepted', 'finding.bulk_rejected'];

/** Per accountant: what is waiting in the clients they work on, and when they last decided something. */
export async function workload(orgId: string, people: readonly (AccountantOption & { clientIds: string[] })[], stats: readonly ClientStats[]): Promise<WorkloadRow[]> {
  if (people.length === 0) return [];
  const last = await db.auditEvent.groupBy({
    by: ['actorId'],
    where: { orgId, action: { in: PERSONAL_DECISIONS }, actorId: { in: people.map((p) => p.id) } },
    _max: { createdAt: true },
  });
  const lastBy = new Map(last.map((l) => [l.actorId, l._max.createdAt]));
  return people.map((p) => {
    const mine = p.clientIds.length === 0 ? stats : stats.filter((c) => p.clientIds.includes(c.id));
    const sum = (pick: (c: ClientStats) => number): number => mine.reduce((n, c) => n + pick(c), 0);
    return {
      userId: p.id, email: p.email, assigned: p.clientIds.length === 0 ? null : p.clientIds.length, clients: mine.length,
      openRows: sum((c) => c.openRows), pendingFindings: sum((c) => c.pendingFindings), overdueTasks: sum((c) => c.overdueTasks),
      lastDecisionAt: lastBy.get(p.id) ?? null,
    };
  });
}

export type DashboardViewer = { orgId: string; role: string; clientIds?: string[] | null };

export type Dashboard = {
  /** Clients shown (after the accountant filter), most in need of attention first. */
  clients: ClientStats[];
  totals: Totals;
  byType: TypeCount[];
  changes: Change[];
  accountants: AccountantOption[];
  selected: AccountantOption | null;
  workload: WorkloadRow[] | null;
};

const MAX_CLIENTS = 2000;

export async function dashboard(user: DashboardViewer, accountantId: string | null): Promise<Dashboard> {
  const admin = user.role === 'admin';
  const people = admin ? await accountantOptions(user.orgId) : [];
  const chosen = accountantId ? people.find((p) => p.id === accountantId) ?? null : null;
  const all = (await clientStats({ orgId: user.orgId, clientIds: user.clientIds ?? null, filter: 'all', sort: 'attention', limit: MAX_CLIENTS })).rows;
  // An accountant with no assignments works on every client, so the filter shows them all.
  const clients = chosen && chosen.clientIds.length > 0 ? all.filter((c) => chosen.clientIds.includes(c.id)) : all;
  const catalogIds = clients.flatMap((c) => (c.catalogId ? [c.catalogId] : []));
  const [byType, changes, load] = await Promise.all([
    pendingByType(catalogIds),
    changesSincePrevious(user.orgId, clients),
    admin ? workload(user.orgId, people, all) : Promise.resolve(null),
  ]);
  const strip = ({ id, email, assigned }: AccountantOption): AccountantOption => ({ id, email, assigned });
  return {
    clients, totals: dashboardTotals(clients), byType, changes,
    accountants: people.map(strip), selected: chosen ? strip(chosen) : null, workload: load,
  };
}

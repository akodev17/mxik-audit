// What the clients pages read, in one call each: the list with its attention reasons and filter
// counts (GET /api/clients) and one client's page (GET /api/clients/{id}). The same queries
// clients/page.tsx and clients/[id]/page.tsx run in the web app.
import { db } from '@tasnivo/db';
import { canSeeClient, canWrite, isAdminRole } from './access';
import { activityPage, type ActivityRow } from './activity';
import { catalogList, type CatalogListItem } from './catalogs';
import { clientAttention, pendingAudits, type AttentionReason } from './client-attention';
import { assignableAccountants, clientDependants, type AssignableAccountant, type ClientDependants } from './client-lifecycle';
import { clientStats, STALE_DAYS, type ClientFilter, type ClientSort, type ClientStats, type FilterCounts } from './client-stats';
import { getSchedule } from './reminders';
import type { CurrentUser } from './session';

export const CLIENT_PAGE_SIZE = 50;

export type ClientListQuery = {
  q?: string | undefined;
  filter?: ClientFilter | undefined;
  sort?: ClientSort | undefined;
  /** Days without an audit after which a client counts as stale (30, 60 or 90). */
  days?: number | undefined;
  /** 0-based. */
  page?: number | undefined;
};

export type ClientList = {
  rows: (ClientStats & { attention: AttentionReason[] })[];
  total: number;
  counts: FilterCounts;
  pageSize: number;
  staleDays: number;
};

/** The clients the user may see, one page, each with why it needs attention (none once archived). */
export async function clientList(user: Pick<CurrentUser, 'orgId' | 'clientIds'>, query: ClientListQuery): Promise<ClientList> {
  const staleDays = STALE_DAYS.find((d) => d === query.days) ?? STALE_DAYS[0];
  const page = Math.max(0, Math.floor(query.page ?? 0));
  const data = await clientStats({
    orgId: user.orgId, clientIds: user.clientIds, search: (query.q ?? '').trim().slice(0, 100),
    filter: query.filter ?? 'all', staleDays, sort: query.sort ?? 'attention', limit: CLIENT_PAGE_SIZE, offset: page * CLIENT_PAGE_SIZE,
  });
  const pending = await pendingAudits(user.orgId, data.rows.filter((c) => !c.archivedAt));
  return {
    rows: data.rows.map((c) => ({ ...c, attention: c.archivedAt ? [] : clientAttention(c, pending) })),
    total: data.total,
    counts: data.counts,
    pageSize: CLIENT_PAGE_SIZE,
    staleDays,
  };
}

const HISTORY_SIZE = 40;

export type ClientSchedule = { clientId: string; dayOfMonth: number; assigneeId: string | null; enabled: boolean; lastPeriod: string | null; updatedAt: Date };

export type ClientPage = {
  client: { id: string; name: string; isDefault: boolean; archivedAt: Date | null; activity: 'savdo' | 'ishlab_chiqarish' | 'boshqa' | null };
  stats: ClientStats | null;
  catalogs: { items: CatalogListItem[]; total: number };
  drafts: CatalogListItem[];
  history: { rows: ActivityRow[]; hasMore: boolean };
  schedule: ClientSchedule | null;
  /** Members who can be reminded about this client: not viewers, and able to open it (the current assignee stays listed). */
  staff: { id: string; email: string; role: CurrentUser['role']; clientIds: string[] }[];
  /** Admins only. */
  accountants: AssignableAccountant[] | null;
  /** Admins only, never in a demo. */
  dependants: ClientDependants | null;
};

/** One client's page; null when the client is missing, another org's, or outside the user's scope. */
export async function clientPage(user: CurrentUser, clientId: string): Promise<ClientPage | null> {
  const client = await db.client.findFirst({
    where: { id: clientId, orgId: user.orgId },
    select: { id: true, name: true, isDefault: true, archivedAt: true, activity: true },
  });
  if (!client || !canSeeClient(user, client.id)) return null;
  const admin = isAdminRole(user);
  const writer = canWrite(user) && !user.demo;
  const archived = client.archivedAt !== null;

  const [statsPage, catalogs, drafts, history, schedule, staff, accountants, dependants] = await Promise.all([
    clientStats({ orgId: user.orgId, clientIds: [client.id], filter: archived ? 'archived' : 'all', limit: 1 }),
    catalogList(user, client.id),
    writer && !archived ? catalogList(user, client.id, 0, 'drafts') : Promise.resolve({ items: [] }),
    activityPage(user, { clientId: client.id, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: HISTORY_SIZE }),
    getSchedule(user.orgId, client.id),
    db.user.findMany({
      where: { orgId: user.orgId, role: { not: 'viewer' } }, orderBy: { email: 'asc' },
      select: { id: true, email: true, role: true, assignments: { select: { clientId: true } } },
    }),
    admin ? assignableAccountants(user.orgId, client.id) : Promise.resolve(null),
    admin && !user.demo ? clientDependants(user.orgId, client.id) : Promise.resolve(null),
  ]);
  return {
    client,
    stats: statsPage.rows[0] ?? null,
    catalogs,
    drafts: drafts.items,
    history: { rows: history.rows, hasMore: history.hasMore },
    schedule: schedule
      ? { clientId: schedule.clientId, dayOfMonth: schedule.dayOfMonth, assigneeId: schedule.assigneeId, enabled: schedule.enabled, lastPeriod: schedule.lastPeriod, updatedAt: schedule.updatedAt }
      : null,
    staff: staff
      .filter((p) => p.id === schedule?.assigneeId || p.role === 'admin' || p.assignments.length === 0 || p.assignments.some((a) => a.clientId === client.id))
      .map((p) => ({ id: p.id, email: p.email, role: p.role, clientIds: p.assignments.map((a) => a.clientId) })),
    accountants,
    dependants,
  };
}

// The audit log page's data: the filters as typed (unreadable days dropped, a reversed range
// swapped, a client or member outside the viewer's reach ignored), one page of rows with the total,
// and the client and member pickers. The API's GET /api/activity answers this.
import { db } from '@tasnivo/db';
import { clientScope } from './access.js';
import { activityPage, CATEGORIES, type ActivityRow, type Category } from './activity.js';
import { parseDayInput } from './activity-dates.js';
import type { CurrentUser } from './session.js';

export type ActivityQuery = { client?: string; user?: string; category?: string; from?: string; to?: string; page?: number };

export type ActivityView = {
  rows: ActivityRow[];
  hasMore: boolean;
  total: number | null;
  pageSize: number;
  clients: { id: string; name: string }[];
  users: { id: string; email: string }[];
  /** The filters as applied: yyyy-mm-dd days (or null), a known client and member (or null). */
  applied: { clientId: string | null; userId: string | null; category: Category; from: string | null; to: string | null; page: number };
  /** A day could not be read and was dropped; the range was given in reverse and swapped. */
  unreadable: boolean;
  swapped: boolean;
};

export async function activityView(user: Pick<CurrentUser, 'userId' | 'orgId' | 'role' | 'clientIds'>, q: ActivityQuery): Promise<ActivityView> {
  const category: Category = CATEGORIES.find((c) => c === q.category) ?? 'all';
  const page = Math.max(0, Math.floor(q.page ?? 0));
  const typedFrom = parseDayInput(q.from);
  const typedTo = parseDayInput(q.to);
  let from = typedFrom ?? '';
  let to = typedTo ?? '';
  const swapped = Boolean(from && to && from > to);
  if (swapped) [from, to] = [to, from];

  const [clients, users] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId, ...clientScope(user) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { orgId: user.orgId }, orderBy: { email: 'asc' }, select: { id: true, email: true } }),
  ]);
  // A client id outside the user's scope is ignored, never trusted.
  const clientId = clients.find((c) => c.id === q.client)?.id ?? null;
  const userId = users.find((u) => u.id === q.user)?.id ?? null;
  const applied = { clientId, userId, category, from: from || null, to: to || null, page };
  const result = await activityPage(user, applied, { withTotal: true });
  return { ...result, clients, users, applied, unreadable: typedFrom === null || typedTo === null, swapped };
}

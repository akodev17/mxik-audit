// The cross-catalogue pages as one read each, the way dashboard/page.tsx and queue/page.tsx put
// them together today: the API serves these (GET /api/dashboard, GET /api/queue).
import { db } from '@tasnivo/db';
import { clientScope, isAdminRole } from './access.js';
import { activityPage, type ActivityRow } from './activity.js';
import type { PendingAudit } from './client-attention.js';
import { accountantOptions, dashboard, type AccountantOption, type Dashboard } from './dashboard.js';
import { checklistHidden, checklistOpen, onboardingSteps, type Step } from './onboarding.js';
import { decodeQueueCursor, queuePage, readQueueFilter, type QueuePage } from './queue.js';
import { openTasks, type OpenTask } from './reminders.js';
import { openReviews, reviewCounts, type OpenReview, type ReviewCounts } from './review-assignments.js';
import type { CurrentUser } from './session.js';

/** Recent events the dashboard's activity tab reads (it shows the first groups of them). */
export const DASHBOARD_ACTIVITY = 40;

export type DashboardView = Omit<Dashboard, 'pending'> & {
  /** Clients whose newest upload is not audited yet, by status (the Map as a record). */
  pending: Record<string, PendingAudit>;
  onboarding: Step[];
  /** open: a required step is not done (optional ones never count); hidden: this person closed the card. */
  checklist: { open: boolean; hidden: boolean };
  /** Open monthly checks of the clients shown. */
  tasks: OpenTask[];
  reviews: { open: OpenReview[]; counts: ReviewCounts };
  activity: ActivityRow[];
  role: CurrentUser['role'];
};

/** Everything the dashboard shows except the plan; `accountant` is an admin's filter, `mine` the reviews tab's. */
export async function dashboardView(user: CurrentUser, opts: { accountant?: string | null | undefined; mine?: boolean | undefined } = {}): Promise<DashboardView> {
  const admin = isAdminRole(user);
  const [data, allTasks, steps, hidden, recent, open, counts] = await Promise.all([
    dashboard(user, admin ? opts.accountant ?? null : null),
    openTasks(user.orgId, user.clientIds),
    onboardingSteps(user),
    checklistHidden(user.userId),
    activityPage(user, { clientId: null, userId: null, category: 'all', from: null, to: null, page: 0 }, { pageSize: DASHBOARD_ACTIVITY, committedOnly: true }),
    openReviews(user, { mineOnly: opts.mine === true }),
    reviewCounts(user),
  ]);
  const shown = new Set(data.clients.map((c) => c.id));
  return {
    ...data,
    pending: Object.fromEntries(data.pending),
    onboarding: steps,
    checklist: { open: checklistOpen(steps), hidden },
    tasks: allTasks.filter((x) => shown.has(x.clientId)),
    reviews: { open, counts },
    activity: recent.rows,
    role: user.role,
  };
}

export type QueueParams = { client?: string; type?: string; severity?: string; flag?: string; accountant?: string; due?: string; cursor?: string };

export type QueueView = QueuePage & {
  /** The client picker: clients the user may see, not archived, by name. */
  clients: { id: string; name: string }[];
  /** The accountant picker; admins only (null otherwise). */
  accountants: (AccountantOption & { clientIds: string[] })[] | null;
};

/** One page of the review queue with what its pickers need; the accountant filter is an admin's only. */
export async function queueView(user: CurrentUser, params: QueueParams): Promise<QueueView> {
  const admin = isAdminRole(user);
  const filter = readQueueFilter(params);
  if (!admin) filter.accountantId = null;
  const [clients, people, page] = await Promise.all([
    db.client.findMany({ where: { orgId: user.orgId, archivedAt: null, ...clientScope(user) }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    admin ? accountantOptions(user.orgId) : Promise.resolve(null),
    queuePage(user, filter, decodeQueueCursor(params.cursor)),
  ]);
  return { ...page, clients, accountants: people };
}

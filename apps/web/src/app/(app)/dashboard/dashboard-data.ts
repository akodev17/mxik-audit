// The dashboard's data from the API (GET /api/dashboard, GET /api/billing/plan), with the dates
// turned back into Date for the components and pure helpers that sort and format them.
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { serverApi } from '@/lib/api/server';

type Answer = ResponseOf<typeof endpoints.workspace.dashboard>;

const day = (v: string): Date => new Date(v);
const maybe = (v: string | null): Date | null => (v === null ? null : new Date(v));

/** Turns the wire answer (ISO strings, the pending audits as a record) into the shapes the page renders. */
export function reviveDashboard(a: Answer) {
  const clients = a.clients.map((c) => ({ ...c, archivedAt: maybe(c.archivedAt), createdAt: day(c.createdAt), auditedAt: maybe(c.auditedAt) }));
  const changes = a.changes.map((c) => ({ ...c, auditedAt: day(c.auditedAt) }));
  const workload = a.workload?.map((w) => ({ ...w, lastDecisionAt: maybe(w.lastDecisionAt) })) ?? null;
  const reviews = a.reviews.open.map((r) => ({ ...r, dueOn: maybe(r.dueOn) }));
  const activity = a.activity.map((r) => ({ ...r, at: day(r.at) }));
  const pending = new Map(Object.entries(a.pending));
  return { ...a, clients, changes, workload, pending, reviews: { open: reviews, counts: a.reviews.counts }, activity };
}

/** One read for the page: an admin's accountant filter and the reviews tab ("mine") travel as the URL has them. */
export async function dashboardData(sp: { accountant?: string; rv?: string }) {
  const api = serverApi();
  // Ids longer than the API takes match no accountant either way; an empty one means none.
  const accountant = sp.accountant ? sp.accountant.slice(0, 64) : undefined;
  const [answer, plan] = await Promise.all([
    api.workspace.dashboard({ ...(accountant ? { accountant } : {}), ...(sp.rv === 'mine' ? { rv: 'mine' as const } : {}) }),
    api.billing.plan(),
  ]);
  return { data: reviveDashboard(answer), plan: plan.status };
}

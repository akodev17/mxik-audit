// The platform admin's billing page (GET /api/admin/billing): one page of customer orgs with their plan,
// the trial and paid-period ends and the last paid order, plus paid orders of the last 30 days across
// every customer org. Orders paid in a provider's sandbox (testMode) are flagged and kept out of the
// counts and sums.
import { db } from '@tasnivo/db';
import type { PlanState } from '../plan';
import { planById, SUBSCRIPTION_IDS, type Tier } from './plans';

const WINDOW_MS = 30 * 86_400_000;
export const ADMIN_BILLING_PAGE_SIZE = 50;

export type PaidOrder = { id: string; planId: string; amount: number; provider: string | null; paidAt: Date; testMode: boolean };
export type Paid30 = { count: number; sum: number; test: number };

export type OrgBilling = {
  id: string;
  name: string;
  closedAt: Date | null;
  state: Exclude<PlanState, 'unlimited'>;
  tier: Tier | null;
  trialEndsAt: Date | null;
  subscriptionUntil: Date | null;
  lastPaid: PaidOrder | null;
  last30: Paid30;
};

export type PageWindow = { page: number; pageSize: number; pageCount: number; skip: number };

export type BillingOverview = { generatedAt: Date; last30: Paid30; orgs: OrgBilling[]; total: number } & Omit<PageWindow, 'skip'>;

/** A 1-based page clamped to the pages that exist, so an edited URL past the end shows the last one. */
export function pageWindow(total: number, page = 1, pageSize = ADMIN_BILLING_PAGE_SIZE): PageWindow {
  const size = Math.max(1, Math.trunc(pageSize));
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(pageCount, Math.max(1, Math.trunc(page)));
  return { page: current, pageSize: size, pageCount, skip: (current - 1) * size };
}

export async function billingOverview(opts: { page?: number; pageSize?: number; now?: Date } = {}): Promise<BillingOverview> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - WINDOW_MS);
  const customers = { kind: 'customer' } as const;
  const [total, sums] = await Promise.all([
    db.organization.count({ where: customers }),
    // Refunded orders leave the counts and sums; test payments are counted apart.
    db.order.groupBy({
      by: ['testMode'],
      where: { org: customers, status: 'paid', paidAt: { gte: since } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
  const last30: Paid30 = { count: 0, sum: 0, test: 0 };
  for (const g of sums) {
    if (g.testMode) last30.test += g._count._all;
    else { last30.count += g._count._all; last30.sum += g._sum.amount ?? 0; }
  }

  const { skip, ...window } = pageWindow(total, opts.page, opts.pageSize);
  const orgs = await db.organization.findMany({
    where: customers,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip,
    take: window.pageSize,
    select: { id: true, name: true, deletedAt: true, trialEndsAt: true, subscriptionUntil: true },
  });
  // Paid (and later refunded) orders, newest first: the first per org is its last paid order.
  const orders = await db.order.findMany({
    where: { orgId: { in: orgs.map((o) => o.id) }, status: { in: ['paid', 'refunded'] }, paidAt: { not: null } },
    orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
    select: { id: true, orgId: true, planId: true, amount: true, provider: true, paidAt: true, testMode: true, status: true },
  });
  const byOrg = new Map<string, typeof orders>();
  for (const o of orders) {
    if (!o.orgId) continue;
    const list = byOrg.get(o.orgId);
    if (list) list.push(o);
    else byOrg.set(o.orgId, [o]);
  }

  const rows = orgs.map((org): OrgBilling => {
    const mine = byOrg.get(org.id) ?? [];
    const paid30: Paid30 = { count: 0, sum: 0, test: 0 };
    for (const o of mine) {
      if (o.status !== 'paid' || !o.paidAt || o.paidAt < since) continue;
      if (o.testMode) paid30.test += 1;
      else { paid30.count += 1; paid30.sum += o.amount; }
    }
    const last = mine.find((o) => o.status === 'paid');
    // The same order of checks as planStatus: a running paid period, then a running trial.
    const state = org.subscriptionUntil && org.subscriptionUntil > now ? 'firm' : org.trialEndsAt && org.trialEndsAt > now ? 'trial' : 'expired';
    const subscription = mine.find((o) => SUBSCRIPTION_IDS.includes(o.planId));
    return {
      id: org.id, name: org.name, closedAt: org.deletedAt, state,
      tier: state === 'firm' ? (subscription ? planById(subscription.planId)?.tier : null) ?? 'firm' : null,
      trialEndsAt: org.trialEndsAt, subscriptionUntil: org.subscriptionUntil,
      lastPaid: last?.paidAt ? { id: last.id, planId: last.planId, amount: last.amount, provider: last.provider, paidAt: last.paidAt, testMode: last.testMode } : null,
      last30: paid30,
    };
  });
  return { generatedAt: now, last30, orgs: rows, total, ...window };
}

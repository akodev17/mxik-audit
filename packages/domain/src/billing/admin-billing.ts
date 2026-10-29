// The platform admin's billing page (GET /api/admin/billing): every customer org with its plan, the
// trial and paid-period ends and its last paid order, plus paid orders of the last 30 days. Orders
// paid in a provider's sandbox (testMode) are flagged and kept out of the counts and sums.
import { db } from '@tasnivo/db';
import type { PlanState } from '../plan';
import { planById, SUBSCRIPTION_IDS, type Tier } from './plans';

const WINDOW_MS = 30 * 86_400_000;

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

export type BillingOverview = { generatedAt: Date; last30: Paid30; orgs: OrgBilling[] };

export async function billingOverview(now = new Date()): Promise<BillingOverview> {
  const since = new Date(now.getTime() - WINDOW_MS);
  const orgs = await db.organization.findMany({
    where: { kind: 'customer' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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

  const total: Paid30 = { count: 0, sum: 0, test: 0 };
  const rows = orgs.map((org): OrgBilling => {
    const mine = byOrg.get(org.id) ?? [];
    const last30: Paid30 = { count: 0, sum: 0, test: 0 };
    // Refunded orders leave the counts and sums; test payments are counted apart.
    for (const o of mine) {
      if (o.status !== 'paid' || !o.paidAt || o.paidAt < since) continue;
      if (o.testMode) last30.test += 1;
      else { last30.count += 1; last30.sum += o.amount; }
    }
    total.count += last30.count; total.sum += last30.sum; total.test += last30.test;
    const last = mine.find((o) => o.status === 'paid');
    // The same order of checks as planStatus: a running paid period, then a running trial.
    const state = org.subscriptionUntil && org.subscriptionUntil > now ? 'firm' : org.trialEndsAt && org.trialEndsAt > now ? 'trial' : 'expired';
    const subscription = mine.find((o) => SUBSCRIPTION_IDS.includes(o.planId));
    return {
      id: org.id, name: org.name, closedAt: org.deletedAt, state,
      tier: state === 'firm' ? (subscription ? planById(subscription.planId)?.tier : null) ?? 'firm' : null,
      trialEndsAt: org.trialEndsAt, subscriptionUntil: org.subscriptionUntil,
      lastPaid: last?.paidAt ? { id: last.id, planId: last.planId, amount: last.amount, provider: last.provider, paidAt: last.paidAt, testMode: last.testMode } : null,
      last30,
    };
  });
  return { generatedAt: now, last30: total, orgs: rows };
}

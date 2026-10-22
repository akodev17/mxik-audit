// What the plan tab, the app frame and a catalogue's payment box show: plan state and usage, the
// limits, what can be bought and this month's API use (GET /api/billing/plan), and whether one
// catalogue's corrected file can be, or was, paid for (GET /api/catalogs/{id}/purchase).
import { db } from '@tasnivo/db';
import { catalogScope, isAdminRole } from '../access';
import { apiConfig, monthlyCheckCap, usageThisMonth } from '../api/limits';
import { planStatus, type PlanStatus } from '../plan';
import type { CurrentUser } from '../session';
import { catalogPurchase, purchaseOf, type CatalogPurchase, type Purchase } from './availability';
import { billingConfig } from './config';
import { planLimits, TRIAL_DAYS, type Limits } from './limits';
import { catalogPaid } from './orders';
import { catalogPlan, firmPlan, type Plan } from './plans';

type Viewer = Pick<CurrentUser, 'orgId' | 'role'>;

export type BillingPlan = {
  status: PlanStatus;
  /** The paid subscription's end, while it is in the future. */
  subscriptionUntil: Date | null;
  limits: { trial: Limits; firm: Limits };
  trialDays: number;
  /** The firm subscription; null while its price is unset. */
  plan: Plan | null;
  purchase: Purchase;
  api: { checks: number; requests: number; monthlyCap: number | null };
};

/** plan-tab.tsx's reads; `demo` = the org is a demo copy (nothing is paid there). */
export async function billingPlan(viewer: Viewer, demo: boolean, now = new Date()): Promise<BillingPlan> {
  const [status, org, api] = await Promise.all([
    planStatus(viewer.orgId, now),
    db.organization.findUnique({ where: { id: viewer.orgId }, select: { subscriptionUntil: true } }),
    usageThisMonth(viewer.orgId),
  ]);
  const plan = firmPlan();
  return {
    status,
    subscriptionUntil: org?.subscriptionUntil && org.subscriptionUntil > now ? org.subscriptionUntil : null,
    limits: planLimits(),
    trialDays: TRIAL_DAYS,
    plan,
    purchase: purchaseOf({ plan, config: billingConfig(), admin: isAdminRole(viewer), demo }),
    api: { checks: api.checks, requests: api.requests, monthlyCap: monthlyCheckCap(status.state, apiConfig()) },
  };
}

export type CatalogBilling = {
  purchase: CatalogPurchase;
  /** The catalogue's price tier; null above the largest one. */
  planId: string | null;
  /** The rows that tier covers (the price is "for up to N rows"); null with planId. */
  maxRows: number | null;
  /** BILLING_REQUIRED_FOR_EXPORT: the corrected file needs this payment (or a subscription) first. */
  requiredForExport: boolean;
};

/** billing-box.tsx's reads for a catalogue the viewer can see; null for any other id. */
export async function catalogBilling(viewer: Viewer & Pick<CurrentUser, 'clientIds'>, catalogId: string, demo: boolean): Promise<CatalogBilling | null> {
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(viewer) }, select: { id: true, rowCount: true } });
  if (!catalog) return null;
  const config = billingConfig();
  const plan = catalogPlan(catalog.rowCount);
  const paid = await catalogPaid(viewer.orgId, catalog.id);
  return {
    purchase: catalogPurchase({ plan, config, admin: isAdminRole(viewer), demo, paid }),
    planId: plan?.id ?? null,
    maxRows: plan?.maxRows ?? null,
    requiredForExport: config.requiredForExport,
  };
}

// The org's orders for its admins (GET /api/billing/orders) and one paid order's receipt
// (GET /api/billing/orders/{orderId}). Always read within the viewer's org.
import { db } from '@tasnivo/db';
import type { CurrentUser } from '../session';
import { planById, type Tier } from './plans';

type Viewer = Pick<CurrentUser, 'orgId'>;

export type OrderStatusName = 'created' | 'paid' | 'cancelled' | 'refunded';

export type OrderRow = {
  id: string;
  createdAt: Date;
  paidAt: Date | null;
  planId: string;
  kind: 'subscription' | 'catalog' | null;
  /** Subscriptions: the tier and the months one payment buys. */
  tier: Tier | null;
  months: number | null;
  /** Catalogue orders: the rows the tier covers, and the catalogue. */
  maxRows: number | null;
  catalogId: string | null;
  amount: number;
  provider: string | null;
  status: OrderStatusName;
  /** Paid in a provider's sandbox: no real money moved. */
  testMode: boolean;
  /** The paid period's end this payment set (its billing.paid audit event); null for catalogues and older orders. */
  periodEnd: Date | null;
};

export type Receipt = OrderRow & { orgName: string | null };

/** The history shows this many orders, newest first. */
export const HISTORY_LIMIT = 200;

const SELECT = {
  id: true, createdAt: true, paidAt: true, planId: true, catalogId: true, amount: true, provider: true, status: true, testMode: true, orgName: true,
} as const;

type Raw = { id: string; createdAt: Date; paidAt: Date | null; planId: string; catalogId: string | null; amount: number; provider: string | null; status: OrderStatusName; testMode: boolean };

function row(o: Raw, periodEnd: Date | null): OrderRow {
  const plan = planById(o.planId);
  return {
    id: o.id, createdAt: o.createdAt, paidAt: o.paidAt, planId: o.planId,
    kind: plan?.kind ?? null, tier: plan?.tier ?? null, months: plan?.months ?? null, maxRows: plan?.maxRows ?? null,
    catalogId: o.catalogId, amount: o.amount, provider: o.provider, status: o.status, testMode: o.testMode, periodEnd,
  };
}

/** The `until` each order's billing.paid event recorded (subscriptions since the tiers). */
async function periodEnds(orgId: string, orderIds: string[]): Promise<Map<string, Date>> {
  if (orderIds.length === 0) return new Map();
  const events = await db.auditEvent.findMany({ where: { orgId, action: 'billing.paid', targetId: { in: orderIds } }, select: { targetId: true, payload: true } });
  const out = new Map<string, Date>();
  for (const e of events) {
    const until = e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>)['until'] : null;
    if (e.targetId && typeof until === 'string' && !Number.isNaN(Date.parse(until))) out.set(e.targetId, new Date(until));
  }
  return out;
}

export async function orderHistory(viewer: Viewer): Promise<OrderRow[]> {
  const orders = await db.order.findMany({ where: { orgId: viewer.orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: HISTORY_LIMIT, select: SELECT });
  const ends = await periodEnds(viewer.orgId, orders.map((o) => o.id));
  return orders.map((o) => row(o, ends.get(o.id) ?? null));
}

/** A receipt exists for an order that was paid (refunded ones included); null for another org's or an unpaid order. */
export async function orderReceipt(viewer: Viewer, orderId: string): Promise<Receipt | null> {
  const order = await db.order.findFirst({ where: { id: orderId, orgId: viewer.orgId, status: { in: ['paid', 'refunded'] } }, select: SELECT });
  if (!order) return null;
  const ends = await periodEnds(viewer.orgId, [order.id]);
  return { ...row(order, ends.get(order.id) ?? null), orgName: order.orgName };
}

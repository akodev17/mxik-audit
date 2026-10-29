// A refund the owner made by hand (npm run billing:refund): Click and Payme are not asked, since no
// refund API is wired here. The order goes paid → refunded once, a subscription's paid period is
// shortened by the refunded share, and an audit event records it. A catalogue order's export is
// locked again because only paid orders unlock a catalogue (catalogPaid).
import { db } from '@tasnivo/db';
import { PAY_TX } from './orders';
import { addMonths } from './period';
import { planById } from './plans';

const DAY = 86_400_000;

export type RefundInput = {
  orderId: string;
  /** Days of the paid period to take back; absent = the whole period this order bought (its months). */
  days?: number;
  note?: string;
};

export type Refund = {
  orderId: string;
  orgId: string | null;
  planId: string;
  amount: number;
  /** The org's paid period before and after (null: no subscription involved or no org any more). */
  until: { before: Date | null; after: Date | null };
};

export type RefundResult = { ok: true; refund: Refund } | { ok: false; reason: 'not_found' | 'not_paid' | 'bad_days' };

/**
 * The new end of a paid period after refunding `days` (or the plan's `months`) of it: never before
 * `now`, and an end already past is left alone.
 */
export function shortenedUntil(until: Date, now: Date, take: { days?: number; months: number }): Date {
  if (until <= now) return until;
  const end = take.days === undefined ? addMonths(until, -take.months) : new Date(until.getTime() - take.days * DAY);
  return end > now ? end : now;
}

export async function refundOrder(input: RefundInput, now = new Date()): Promise<RefundResult> {
  if (input.days !== undefined && !(Number.isInteger(input.days) && input.days > 0)) return { ok: false, reason: 'bad_days' };
  const head = await db.order.findUnique({ where: { id: input.orderId }, select: { orgId: true } });
  if (!head) return { ok: false, reason: 'not_found' };
  const orgId = head.orgId;
  return db.$transaction(async (tx) => {
    // The same per-org lock as markPaid: a renewal paid meanwhile cannot start from the old end.
    if (orgId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('billing_org'), hashtext(${orgId}))`;
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) return { ok: false, reason: 'not_found' } as const;
    const claimed = await tx.order.updateMany({ where: { id: order.id, status: 'paid' }, data: { status: 'refunded' } });
    if (claimed.count !== 1) return { ok: false, reason: 'not_paid' } as const;

    const plan = planById(order.planId);
    let before: Date | null = null;
    let after: Date | null = null;
    if (orgId && plan?.kind === 'subscription') {
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { subscriptionUntil: true } });
      before = org?.subscriptionUntil ?? null;
      after = before ? shortenedUntil(before, now, { days: input.days, months: plan.months ?? 1 }) : null;
      if (before && after && after.getTime() !== before.getTime()) await tx.organization.update({ where: { id: orgId }, data: { subscriptionUntil: after } });
    }
    if (orgId) {
      await tx.auditEvent.create({
        data: {
          orgId, actorId: null, action: 'billing.refunded', targetId: order.id,
          payload: {
            planId: order.planId, amount: order.amount, provider: order.provider, catalogId: order.catalogId, testMode: order.testMode,
            days: input.days ?? null, note: input.note ?? null,
            until: { before: before?.toISOString() ?? null, after: after?.toISOString() ?? null },
          },
        },
      });
    }
    return { ok: true, refund: { orderId: order.id, orgId, planId: order.planId, amount: order.amount, until: { before, after } } } as const;
  }, PAY_TX);
}

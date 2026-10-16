// Orders: created by a signed-in user, paid by a provider callback. Every
// state change is checked against the current state, so a replayed callback
// changes nothing.
import { db } from '../db.js';
import type { Actor } from '../decisions.js';
import { catalogPlan, planById } from './plans.js';

export type NewOrder = { planId: string; catalogId: string | null };

/** An order at the plan's current price; a catalogue order must match its tier. */
export async function createOrder(actor: Actor, input: NewOrder, provider: 'click' | 'payme'): Promise<{ id: string; amount: number } | null> {
  const plan = planById(input.planId);
  if (!plan) return null;
  if (plan.kind === 'catalog') {
    if (!input.catalogId) return null;
    const catalog = await db.catalog.findFirst({ where: { id: input.catalogId, orgId: actor.orgId, status: 'ready' }, select: { rowCount: true } });
    if (!catalog || catalogPlan(catalog.rowCount)?.id !== plan.id) return null;
  }
  const order = await db.order.create({
    data: { orgId: actor.orgId, catalogId: plan.kind === 'catalog' ? input.catalogId : null, planId: plan.id, amount: plan.price, provider },
  });
  await db.auditEvent.create({
    data: { orgId: actor.orgId, actorId: actor.userId, action: 'billing.order_created', targetId: order.id, payload: { planId: plan.id, amount: plan.price, catalogId: input.catalogId, provider } },
  });
  return { id: order.id, amount: order.amount };
}

/** created → paid, once. A subscription extends the org's paid period. */
export async function markPaid(orderId: string, provider: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'created') return false;
    const now = new Date();
    await tx.order.update({ where: { id: order.id }, data: { status: 'paid', paidAt: now, provider } });
    const plan = planById(order.planId);
    if (plan?.kind === 'subscription') {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: order.orgId }, select: { subscriptionUntil: true } });
      const from = org.subscriptionUntil && org.subscriptionUntil > now ? org.subscriptionUntil : now;
      const until = new Date(from);
      until.setMonth(until.getMonth() + 1);
      await tx.organization.update({ where: { id: order.orgId }, data: { subscriptionUntil: until } });
    }
    await tx.auditEvent.create({
      data: { orgId: order.orgId, actorId: null, action: 'billing.paid', targetId: order.id, payload: { planId: order.planId, amount: order.amount, provider, catalogId: order.catalogId } },
    });
    return true;
  });
}

export async function cancelOrder(orderId: string): Promise<void> {
  await db.order.updateMany({ where: { id: orderId, status: 'created' }, data: { status: 'cancelled', cancelledAt: new Date() } });
}

/** A paid order for this catalogue, or an active firm subscription. */
export async function catalogPaid(orgId: string, catalogId: string, now = new Date()): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { subscriptionUntil: true } });
  if (org?.subscriptionUntil && org.subscriptionUntil > now) return true;
  const paid = await db.order.count({ where: { orgId, catalogId, status: 'paid' } });
  return paid > 0;
}

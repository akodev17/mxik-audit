// Orders: created by a signed-in user, paid by a provider callback. Every
// state change is checked against the current state, so a replayed callback
// changes nothing; a payment is claimed once (created → paid) under a per-org
// lock, so two concurrent confirmations never extend a subscription twice.
import type { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import type { Actor } from '../decisions.js';
import { nextPeriod, type ActiveSubscription, type NextPeriod } from './period.js';
import { catalogPlan, planById, SUBSCRIPTION_IDS, type Plan } from './plans.js';

type Client = Prisma.TransactionClient | typeof db;

export type NewOrder = { planId: string; catalogId: string | null };

/** Why an order cannot be made or paid: a catalogue already paid for, or a tier change the rule refuses (plan D2). */
export type PayRefusal = 'already_paid' | 'plan_change';
export type OrderResult = { ok: true; id: string; amount: number } | { ok: false; reason: 'invalid' | PayRefusal };

/** The org's subscription while it runs: the tier of its latest paid subscription order (none = the top tier, set by hand). */
export async function activeSubscription(client: Client, orgId: string, now = new Date()): Promise<ActiveSubscription | null> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { subscriptionUntil: true } });
  if (!org?.subscriptionUntil || org.subscriptionUntil <= now) return null;
  // A refunded order still names the tier: the days a refund leaves are days of that tier (refunds.ts).
  const last = await client.order.findFirst({
    where: { orgId, status: { in: ['paid', 'refunded'] }, planId: { in: SUBSCRIPTION_IDS } }, orderBy: { paidAt: 'desc' }, select: { planId: true },
  });
  return { tier: (last ? planById(last.planId)?.tier : null) ?? 'firm', until: org.subscriptionUntil };
}

/** Whether this org may pay for `plan` now: a catalogue nobody paid for yet, a subscription the tier rule allows. */
async function payable(client: Client, orgId: string, plan: Plan, catalogId: string | null, now: Date, force = false): Promise<{ ok: true; period: NextPeriod | null } | { ok: false; reason: PayRefusal }> {
  if (plan.kind === 'catalog') {
    const paid = await client.order.count({ where: { orgId, catalogId, status: 'paid' } });
    return paid > 0 ? { ok: false, reason: 'already_paid' } : { ok: true, period: null };
  }
  const period = nextPeriod(await activeSubscription(client, orgId, now), plan, now, force);
  return period.ok ? { ok: true, period } : { ok: false, reason: period.reason };
}

/** For a provider's pre-check (Click Prepare, Payme CheckPerform/Create): refuse before any money moves. */
export async function orderPayable(order: { orgId: string | null; planId: string; catalogId: string | null }, now = new Date()): Promise<boolean> {
  const plan = planById(order.planId);
  if (!plan || !order.orgId) return false;
  return (await payable(db, order.orgId, plan, order.catalogId, now)).ok;
}

async function orgName(orgId: string): Promise<string | null> {
  return (await db.organization.findUnique({ where: { id: orgId }, select: { name: true } }))?.name ?? null;
}

/** An order at the plan's current price; a catalogue order must match its tier and not be paid already. */
export async function createOrder(actor: Actor, input: NewOrder, provider: 'click' | 'payme', now = new Date()): Promise<OrderResult> {
  const plan = planById(input.planId);
  if (!plan) return { ok: false, reason: 'invalid' };
  if (plan.kind === 'catalog') {
    if (!input.catalogId) return { ok: false, reason: 'invalid' };
    const catalog = await db.catalog.findFirst({ where: { id: input.catalogId, orgId: actor.orgId, status: 'ready' }, select: { rowCount: true } });
    if (!catalog || catalogPlan(catalog.rowCount)?.id !== plan.id) return { ok: false, reason: 'invalid' };
    // An active subscription already unlocks every catalogue.
    if (await catalogPaid(actor.orgId, input.catalogId, now)) return { ok: false, reason: 'already_paid' };
  }
  const check = await payable(db, actor.orgId, plan, plan.kind === 'catalog' ? input.catalogId : null, now);
  if (!check.ok) return check;
  const order = await db.order.create({
    data: { orgId: actor.orgId, orgName: await orgName(actor.orgId), catalogId: plan.kind === 'catalog' ? input.catalogId : null, planId: plan.id, amount: plan.price, provider },
  });
  await db.auditEvent.create({
    data: { orgId: actor.orgId, actorId: actor.userId, action: 'billing.order_created', targetId: order.id, payload: { planId: plan.id, amount: plan.price, catalogId: input.catalogId, provider } },
  });
  return { ok: true, id: order.id, amount: order.amount };
}

export type PaidOutcome = 'paid' | 'not_payable' | PayRefusal;

/** A provider's confirmation waits for a connection and for the org's lock rather than fail on a busy pool. */
export const PAY_TX = { maxWait: 10_000, timeout: 20_000 } as const;

export type MarkPaidOptions = {
  /** An operator's bank transfer: a cheaper tier while a subscription runs is converted instead of refused. */
  force?: boolean;
  /** Paid through a provider's sandbox: stamped on the order. */
  testMode?: boolean;
  /** The provider's own transaction state, written in the same database transaction (throw to roll back). */
  within?: (tx: Prisma.TransactionClient) => Promise<void>;
};

/**
 * created → paid, once. A subscription sets the org's paid period by the tier rule (period.ts):
 * the same tier extends from the current end, an upgrade starts now with the unused days credited.
 * Only the caller whose claim moves the order out of `created` goes on; any other gets `not_payable`.
 */
export async function markPaid(orderId: string, provider: string, options: MarkPaidOptions = {}): Promise<PaidOutcome> {
  const head = await db.order.findUnique({ where: { id: orderId }, select: { orgId: true } });
  const orgId = head?.orgId;
  if (!orgId) return 'not_payable';
  return db.$transaction(async (tx) => {
    // One payment per org at a time: two renewals must not both start from the same end date.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('billing_org'), hashtext(${orgId}))`;
    const order = await tx.order.findUnique({ where: { id: orderId } });
    const plan = order ? planById(order.planId) : null;
    if (!order || !plan || order.status !== 'created' || order.orgId !== orgId) return 'not_payable';
    const now = new Date();
    const check = await payable(tx, orgId, plan, order.catalogId, now, options.force);
    if (!check.ok) return check.reason;
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: 'created' },
      data: { status: 'paid', paidAt: now, provider, testMode: options.testMode === true },
    });
    if (claimed.count !== 1) return 'not_payable';
    const period = check.period?.ok ? check.period : null;
    if (period) await tx.organization.update({ where: { id: orgId }, data: { subscriptionUntil: period.until } });
    await options.within?.(tx);
    await tx.auditEvent.create({
      data: {
        orgId, actorId: null, action: 'billing.paid', targetId: order.id,
        payload: {
          planId: order.planId, amount: order.amount, provider, catalogId: order.catalogId, testMode: options.testMode === true,
          ...(period ? { period: period.kind, until: period.until.toISOString(), creditDays: period.creditDays } : {}),
        },
      },
    });
    return 'paid';
  }, PAY_TX);
}

export type TransferResult = { ok: true; orderId: string; amount: number } | { ok: false; reason: 'unknown_plan' | 'catalog' | PayRefusal };

/**
 * A bank transfer the owner has received (npm run billing:activate): a paid order at the plan's
 * price, or at `amount` when one was agreed, with the same effects and the same tier rule as a
 * provider's callback (`force` converts a cheaper tier instead of refusing). A catalogue plan needs
 * a ready catalogue of that org in its size tier.
 */
export async function recordTransfer(input: { orgId: string; planId: string; catalogId: string | null; amount?: number; force?: boolean }): Promise<TransferResult> {
  const plan = planById(input.planId);
  if (!plan) return { ok: false, reason: 'unknown_plan' };
  if (plan.kind === 'catalog') {
    if (!input.catalogId) return { ok: false, reason: 'catalog' };
    const catalog = await db.catalog.findFirst({ where: { id: input.catalogId, orgId: input.orgId, status: 'ready' }, select: { rowCount: true } });
    if (!catalog || catalogPlan(catalog.rowCount)?.id !== plan.id) return { ok: false, reason: 'catalog' };
  }
  const amount = input.amount ?? plan.price;
  const order = await db.order.create({
    data: { orgId: input.orgId, orgName: await orgName(input.orgId), catalogId: plan.kind === 'catalog' ? input.catalogId : null, planId: plan.id, amount, provider: 'bank' },
  });
  const outcome = await markPaid(order.id, 'bank', { force: input.force === true });
  if (outcome === 'paid') return { ok: true, orderId: order.id, amount };
  await cancelOrder(order.id);
  return { ok: false, reason: outcome === 'not_payable' ? 'catalog' : outcome };
}

export async function cancelOrder(orderId: string, client: Client = db): Promise<void> {
  await client.order.updateMany({ where: { id: orderId, status: 'created' }, data: { status: 'cancelled', cancelledAt: new Date() } });
}

const ORDER_TTL_MS = 24 * 3_600_000;
const PAYME_OPEN_MS = 12 * 3_600_000;

/**
 * Daily: orders left at `created` for more than 24 hours are cancelled (an abandoned checkout). An
 * order with a provider transaction still open inside Payme's 12-hour window is left to finish.
 */
export async function expireStaleOrders(now = new Date()): Promise<number> {
  const done = await db.order.updateMany({
    where: {
      status: 'created', createdAt: { lt: new Date(now.getTime() - ORDER_TTL_MS) },
      transactions: { none: { state: 1, createTime: { gt: BigInt(now.getTime() - PAYME_OPEN_MS) } } },
    },
    data: { status: 'cancelled', cancelledAt: now },
  });
  return done.count;
}

/** A paid order for this catalogue, or an active firm subscription. */
export async function catalogPaid(orgId: string, catalogId: string, now = new Date()): Promise<boolean> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { subscriptionUntil: true } });
  if (org?.subscriptionUntil && org.subscriptionUntil > now) return true;
  const paid = await db.order.count({ where: { orgId, catalogId, status: 'paid' } });
  return paid > 0;
}

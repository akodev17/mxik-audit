// Plans and payments: plan status and usage, what can be bought, checkout, and the Click and
// Payme callbacks (signature-checked by the provider handlers; paths registered with the providers).
import { z } from 'zod';
import { Id, IsoDateTime, PAYMENT_PROVIDERS, PLAN_RESOURCES, PLAN_TIERS, PlanLimitsOf, PlanOf, TierOffers } from '../common';
import { defineModule, endpoint } from '../endpoint';

const Limits = PlanLimitsOf;
const Resource = z.enum(PLAN_RESOURCES);

/** plan.ts planStatus(). */
export const PlanStatus = z.object({
  state: z.enum(['unlimited', 'trial', 'firm', 'expired']),
  /** The subscription tier while state is 'firm' (any paid subscription). Added with the tiers. */
  tier: z.enum(PLAN_TIERS).nullable(),
  trialEndsAt: IsoDateTime.nullable(),
  daysLeft: z.number().int().nullable(),
  limits: Limits,
  usage: z.object({ clients: z.number().int(), rowsPerMonth: z.number().int(), seats: z.number().int() }),
  warnings: z.array(Resource),
  full: z.array(Resource),
});

/** billing/availability.ts Purchase and CatalogPurchase. */
export const Purchase = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('available'), price: z.number(), providers: z.array(z.enum(PAYMENT_PROVIDERS)) }),
  z.object({ kind: z.literal('not_for_sale') }),
  z.object({ kind: z.literal('no_provider'), price: z.number() }),
  z.object({ kind: z.literal('admin_only'), price: z.number() }),
  z.object({ kind: z.literal('demo') }),
  z.object({ kind: z.literal('paid') }),
  z.object({ kind: z.literal('too_large') }),
]);

/** billing/history.ts OrderRow: one order of the org, as its billing history lists it. */
export const OrderRow = z.object({
  id: z.string(),
  createdAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  planId: z.string(),
  /** Null for a plan id this version does not know. */
  kind: z.enum(['subscription', 'catalog']).nullable(),
  tier: z.enum(PLAN_TIERS).nullable(),
  months: z.number().int().nullable(),
  maxRows: z.number().int().nullable(),
  catalogId: z.string().nullable(),
  amount: z.number().int(),
  provider: z.string().nullable(),
  status: z.enum(['created', 'paid', 'cancelled', 'refunded']),
  /** Paid in a provider's sandbox: no real money moved. */
  testMode: z.boolean(),
  /** The paid period's end this payment set; null for catalogues and orders paid before it was recorded. */
  periodEnd: IsoDateTime.nullable(),
});

export const billing = defineModule('billing', {
  plan: endpoint({
    method: 'GET', path: '/api/billing/plan', auth: 'session', role: 'any',
    summary: 'Plan state, limits, usage, the subscription end and what can be bought',
    responds: 'json',
    response: z.object({
      status: PlanStatus,
      subscriptionUntil: IsoDateTime.nullable(),
      /** company and accountant were added with the tiers; firm is the top tier. */
      limits: z.object({ trial: Limits, company: Limits, accountant: Limits, firm: Limits }),
      trialDays: z.number().int(),
      /** The subscription the org pays for, or the top tier's monthly plan when it has none. */
      plan: PlanOf.nullable(),
      /** Whether a subscription can be bought here; the same for every tier. */
      purchase: Purchase,
      tiers: TierOffers,
      api: z.object({ checks: z.number().int(), requests: z.number().int(), monthlyCap: z.number().int().nullable() }),
    }),
    replaces: ['page:(app)/settings#plan', 'page:(app)/layout#plan'],
    provisional: 'plan-tab.tsx and shell-data.ts combine planStatus, planLimits, tierOffers, purchaseOf and usageThisMonth themselves',
  }),
  catalogPurchase: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/purchase', auth: 'session', role: 'any',
    summary: 'Whether this catalogue\'s export can be (or was) paid for, and how',
    params: z.object({ catalogId: Id }),
    responds: 'json', response: z.object({ purchase: Purchase, planId: z.string().nullable(), maxRows: z.number().int().nullable(), requiredForExport: z.boolean() }),
    replaces: ['page:(app)/catalogs/[id]#billing'],
    provisional: 'billing-box.tsx calls catalogPlan, catalogPaid and catalogPurchase itself',
  }),
  orders: endpoint({
    method: 'GET', path: '/api/billing/orders', auth: 'session', role: 'admin',
    summary: 'The org\'s orders, newest first (at most 200): plan, period, amount, provider, status and test mode',
    responds: 'json', response: z.array(OrderRow),
    replaces: ['page:(app)/settings#billing-history'],
  }),
  receipt: endpoint({
    method: 'GET', path: '/api/billing/orders/{orderId}', auth: 'session', role: 'admin',
    summary: 'One paid (or refunded) order of the org, for its printable receipt',
    params: z.object({ orderId: Id }),
    responds: 'json', response: OrderRow.extend({ orgName: z.string().nullable() }),
    replaces: ['page:(app)/settings/receipt/[orderId]'],
    notes: '404 for another org\'s order and for one that was never paid.',
  }),
  checkout: endpoint({
    method: 'POST', path: '/api/billing/checkout', auth: 'session', role: 'admin',
    summary: 'Create an order at the configured price; answers the provider\'s payment page',
    body: z.object({ planId: z.string().min(1), catalogId: z.string().min(1).nullable(), provider: z.enum(PAYMENT_PROVIDERS) }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), url: z.string() }), z.object({ ok: z.literal(false), error: z.string() })]),
    replaces: ['action:billing.ts#startCheckout'],
    notes: 'A writer who is not an admin gets { ok: false, error: admin_only } (not 403), as before.',
  }),
  click: endpoint({
    method: 'POST', path: '/api/payments/click', auth: 'providerSignature',
    summary: 'Click Prepare/Complete callback (form-urlencoded; "action" tells them apart)',
    body: z.record(z.string()),
    bodyType: 'form-urlencoded',
    responds: 'json', response: z.record(z.union([z.string(), z.number()])),
    replaces: ['route:POST /api/payments/click'],
    notes: '404 while Click is not configured. Signature checked in handleClick. Path registered with Click: keep it.',
  }),
  payme: endpoint({
    method: 'POST', path: '/api/payments/payme', auth: 'providerSignature',
    summary: 'Payme Merchant API (JSON-RPC 2.0, Basic auth checked by paymeAuthorized)',
    body: z.unknown(),
    responds: 'json', response: z.record(z.unknown()),
    replaces: ['route:POST /api/payments/payme'],
    notes: 'Errors are HTTP 200 with a JSON-RPC error, never 401. Path registered with Payme: keep it.',
  }),
});

// Checkout: an order at the configured price and the provider's payment page for it. Shared by the
// web app's startCheckout action and the API's POST /api/billing/checkout; the callers check the
// role and turn a refusal into the message their user reads.
import type { Actor } from '../decisions';
import { purchaseOf, type Provider, type Purchase } from './availability';
import { clickCheckoutUrl } from './click';
import { billingConfig, type BillingConfig } from './config';
import { createOrder } from './orders';
import { paymeCheckoutUrl } from './payme';
import { planById } from './plans';

export type CheckoutInput = { planId: string; catalogId: string | null; provider: Provider };

/**
 * Why nothing can be paid (a Purchase kind), `already_paid` (the catalogue is paid for already),
 * `plan_change` (another tier while a subscription runs, not an upgrade: plan D2), or `failed`
 * when the order or URL could not be made.
 */
export type CheckoutRefusal = Exclude<Purchase['kind'], 'available'> | 'already_paid' | 'plan_change' | 'failed';

export type CheckoutResult = { ok: true; url: string } | { ok: false; reason: CheckoutRefusal };

/** For an org admin (`demo` = the org is a demo copy). The return page is the export or the plan tab. */
export async function startCheckout(admin: Actor, input: CheckoutInput, demo: boolean, config: BillingConfig = billingConfig()): Promise<CheckoutResult> {
  const purchase = purchaseOf({ plan: planById(input.planId), config, admin: true, demo });
  if (purchase.kind !== 'available') return { ok: false, reason: purchase.kind };
  if (!purchase.providers.includes(input.provider)) return { ok: false, reason: 'no_provider' };

  const order = await createOrder(admin, { planId: input.planId, catalogId: input.catalogId }, input.provider);
  if (!order.ok) return { ok: false, reason: order.reason === 'invalid' ? 'failed' : order.reason };
  const back = config.appUrl
    ? `${config.appUrl}${input.catalogId ? `/export?catalog=${input.catalogId}` : '/settings?tab=plan'}`
    : null;
  const url = input.provider === 'click' && config.click
    ? clickCheckoutUrl(config.click, order.id, order.amount, back)
    : input.provider === 'payme' && config.payme ? paymeCheckoutUrl(config.payme, order.id, order.amount, back) : null;
  return url ? { ok: true, url } : { ok: false, reason: 'failed' };
}

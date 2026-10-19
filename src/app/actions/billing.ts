'use server';

import { getI18n } from '@/lib/locale';
import { z } from 'zod';
import { purchaseOf } from '@/lib/billing/availability';
import { clickCheckoutUrl } from '@/lib/billing/click';
import { billingConfig } from '@/lib/billing/config';
import { createOrder } from '@/lib/billing/orders';
import { paymeCheckoutUrl } from '@/lib/billing/payme';
import { planById } from '@/lib/billing/plans';
import { isDemoOrg } from '@/lib/demo';
import { admin, writer } from '@/lib/guard';

const Input = z.object({
  planId: z.string().min(1),
  catalogId: z.string().min(1).nullable(),
  provider: z.enum(['click', 'payme']),
});

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Creates an order at the configured price and returns the provider's payment page. Admins only. */
export async function startCheckout(payload: unknown): Promise<CheckoutResult> {
  const { t, ta } = await getI18n();
  const why = ta.setX.plan.why;
  const user = await admin();
  if (!user) return { ok: false, error: (await writer()) ? why.admin_only : t.errorGeneric };
  const parsed = Input.safeParse(payload);
  if (!parsed.success) return { ok: false, error: t.errorGeneric };
  const config = billingConfig();
  const purchase = purchaseOf({ plan: planById(parsed.data.planId), config, admin: true, demo: await isDemoOrg(user.orgId) });
  if (purchase.kind !== 'available') return { ok: false, error: why[purchase.kind] };
  if (!purchase.providers.includes(parsed.data.provider)) return { ok: false, error: why.no_provider };

  const order = await createOrder(user, { planId: parsed.data.planId, catalogId: parsed.data.catalogId }, parsed.data.provider);
  if (!order) return { ok: false, error: t.errorGeneric };
  const back = config.appUrl
    ? `${config.appUrl}${parsed.data.catalogId ? `/export?catalog=${parsed.data.catalogId}` : '/settings?tab=plan'}`
    : null;
  const url = parsed.data.provider === 'click' && config.click
    ? clickCheckoutUrl(config.click, order.id, order.amount, back)
    : parsed.data.provider === 'payme' && config.payme ? paymeCheckoutUrl(config.payme, order.id, order.amount, back) : null;
  return url ? { ok: true, url } : { ok: false, error: t.errorGeneric };
}

'use server';

import { z } from 'zod';
import { clickCheckoutUrl } from '@/lib/billing/click';
import { billingConfig } from '@/lib/billing/config';
import { createOrder } from '@/lib/billing/orders';
import { paymeCheckoutUrl } from '@/lib/billing/payme';
import { isDemoOrg } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { admin } from '@/lib/guard';

const Input = z.object({
  planId: z.string().min(1),
  catalogId: z.string().min(1).nullable(),
  provider: z.enum(['click', 'payme']),
});

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Creates an order at the configured price and returns the provider's payment page. */
export async function startCheckout(payload: unknown): Promise<CheckoutResult> {
  const user = await admin();
  const parsed = Input.safeParse(payload);
  if (!user || !parsed.success || await isDemoOrg(user.orgId)) return { ok: false, error: t.errorGeneric };
  const config = billingConfig();
  const provider = parsed.data.provider === 'click' ? config.click : config.payme;
  if (!provider) return { ok: false, error: t.errorGeneric };

  const order = await createOrder(user, { planId: parsed.data.planId, catalogId: parsed.data.catalogId }, parsed.data.provider);
  if (!order) return { ok: false, error: t.errorGeneric };
  const back = config.appUrl
    ? `${config.appUrl}${parsed.data.catalogId ? `/export?catalog=${parsed.data.catalogId}` : '/settings'}`
    : null;
  const url = config.click && parsed.data.provider === 'click'
    ? clickCheckoutUrl(config.click, order.id, order.amount, back)
    : config.payme ? paymeCheckoutUrl(config.payme, order.id, order.amount, back) : null;
  return url ? { ok: true, url } : { ok: false, error: t.errorGeneric };
}

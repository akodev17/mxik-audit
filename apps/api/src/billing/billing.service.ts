// actions/billing.ts startCheckout and the plan/payment reads of the settings and catalogue pages;
// the org's order history and receipts (S7).
import { Injectable } from '@nestjs/common';
import { endpoints } from '@tasnivo/contracts';
import { canWrite, isAdminRole } from '@tasnivo/domain/access';
import { startCheckout } from '@tasnivo/domain/billing/checkout';
import { orderHistory, orderReceipt } from '@tasnivo/domain/billing/history';
import { billingPlan, catalogBilling } from '@tasnivo/domain/billing/overview';
import { isDemoOrg } from '@tasnivo/domain/demo';
import type { CurrentUser } from '@tasnivo/domain/session';
import type { Locale } from '@tasnivo/i18n/i18n';
import { i18nFor } from '@tasnivo/i18n/locale';
import { ApiError } from '../http/errors';

export type CheckoutAnswer = { ok: true; url: string } | { ok: false; error: string };

@Injectable()
export class BillingService {
  async plan(user: CurrentUser) {
    return billingPlan(user, await isDemoOrg(user.orgId));
  }

  async catalogPurchase(user: CurrentUser, catalogId: string) {
    const billing = await catalogBilling(user, catalogId, await isDemoOrg(user.orgId));
    if (!billing) throw new ApiError(404, 'not_found', 'Catalogue not found.');
    return billing;
  }

  /** The org's orders (AccessGuard lets admins only through). */
  orders(user: CurrentUser) {
    return orderHistory(user);
  }

  /** One paid order of the org; anything else, another org's included, is 404. */
  async receipt(user: CurrentUser, orderId: string) {
    const receipt = await orderReceipt(user, orderId);
    if (!receipt) throw new ApiError(404, 'not_found', 'Order not found.');
    return receipt;
  }

  /** Admins only, but a writer is told why in the answer (admin_only) rather than refused with a 403. */
  async checkout(user: CurrentUser, body: unknown, locale: Locale): Promise<CheckoutAnswer> {
    const { t, ta } = i18nFor(locale);
    const why = ta.setX.plan.why;
    if (!isAdminRole(user)) return { ok: false, error: canWrite(user) ? why.admin_only : t.errorGeneric };
    const input = endpoints.billing.checkout.body.safeParse(body);
    if (!input.success) return { ok: false, error: t.errorGeneric };
    const result = await startCheckout(user, input.data, await isDemoOrg(user.orgId));
    if (result.ok) return result;
    // Another tier while a subscription runs (not an upgrade): refused outright, with the rule in words.
    if (result.reason === 'plan_change') throw new ApiError(403, 'plan_change', ta.setX.plan.planChange);
    if (result.reason === 'already_paid') return { ok: false, error: ta.setX.billing.alreadyPaid };
    return { ok: false, error: result.reason === 'failed' ? t.errorGeneric : why[result.reason] };
  }
}

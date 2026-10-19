// "Toʻgʻrilangan katalog" payment for this catalogue. Never a pretend checkout: when nothing can be
// paid here it says exactly why (no provider, demo, or only an admin pays).
import { getI18n } from '@/lib/locale';
import { catalogPurchase } from '@/lib/billing/availability';
import { billingConfig } from '@/lib/billing/config';
import { catalogPaid } from '@/lib/billing/orders';
import { catalogPlan } from '@/lib/billing/plans';
import { fmtNumber } from '@/lib/format';
import { PayButtons } from '@/ui/pay-buttons';

type Props = {
  orgId: string;
  catalogId: string;
  rowCount: number;
  /** Only an admin pays; others are told so. Defaults to true for callers that predate roles. */
  canPay?: boolean;
  demo?: boolean;
};

export async function BillingBox({ orgId, catalogId, rowCount, canPay = true, demo = false }: Props) {
  const { locale, t, ta } = await getI18n();
  const plan = catalogPlan(rowCount);
  const purchase = catalogPurchase({ plan, config: billingConfig(), admin: canPay, demo, paid: await catalogPaid(orgId, catalogId) });
  const som = (n: number): string => fmtNumber(locale, n);

  return (
    <section className="space-y-2">
      <h2 className="text-section">{t.payTitle}</h2>
      {purchase.kind === 'paid' ? <p className="text-small text-good-ink">{t.payPaid}</p> : null}
      {purchase.kind === 'too_large' ? <p className="text-small text-muted">{t.payLarge}</p> : null}
      {purchase.kind === 'available' ? (
        <>
          <p className="text-small text-muted">{t.payPrice(som(purchase.price), som(plan?.maxRows ?? rowCount))}</p>
          <PayButtons planId={plan?.id ?? ''} catalogId={catalogId} providers={purchase.providers} />
          <p className="text-micro text-muted">{t.payNote}</p>
        </>
      ) : null}
      {purchase.kind === 'no_provider' || purchase.kind === 'admin_only' || purchase.kind === 'demo' ? (
        <>
          <p className="text-small text-muted">{ta.setX.billing.locked}</p>
          {purchase.kind === 'demo' ? null : <p className="text-small text-muted">{t.payPrice(som(purchase.price), som(plan?.maxRows ?? rowCount))}</p>}
          <p className="text-small">{ta.setX.billing.why[purchase.kind]}</p>
        </>
      ) : null}
    </section>
  );
}

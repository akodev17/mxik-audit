// "Toʻgʻrilangan katalog" payment for this catalogue. Never a pretend checkout: when nothing can be
// paid here it says exactly why (no provider, demo, or only an admin pays).
import { getI18n } from '@/lib/locale';
import { catalogPurchase } from '@tasnivo/domain/billing/availability';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { catalogPaid } from '@tasnivo/domain/billing/orders';
import { catalogPlan } from '@tasnivo/domain/billing/plans';
import { fmtNumber } from '@tasnivo/i18n/format';
import { PayButtons } from '@/ui/pay-buttons';

type Props = {
  orgId: string;
  catalogId: string;
  rowCount: number;
  /** Only an admin pays; others are told so. */
  canPay: boolean;
  /** A demo org never pays; it is told so instead of seeing buttons that would fail. */
  demo: boolean;
};

export async function BillingBox({ orgId, catalogId, rowCount, canPay, demo }: Props) {
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

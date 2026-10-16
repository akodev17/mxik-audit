// "Toʻgʻrilangan katalog" payment for this catalogue. Shown only when a
// payment provider is configured; never a pretend checkout.
import { billingConfig, paymentsEnabled } from '@/lib/billing/config';
import { catalogPaid } from '@/lib/billing/orders';
import { catalogPlan } from '@/lib/billing/plans';
import { t } from '@/lib/i18n';
import { PayButtons } from '@/ui/pay-buttons';

const som = (n: number): string => n.toLocaleString('uz-UZ');

export async function BillingBox({ orgId, catalogId, rowCount }: { orgId: string; catalogId: string; rowCount: number }) {
  const config = billingConfig();
  if (!paymentsEnabled(config)) return <p className="text-sm text-muted">{t.payRequired}</p>;
  const paid = await catalogPaid(orgId, catalogId);
  const plan = catalogPlan(rowCount);
  const providers = [config.click ? 'click' as const : null, config.payme ? 'payme' as const : null]
    .filter((p): p is 'click' | 'payme' => p !== null);

  return (
    <section>
      <h2 className="text-base">{t.payTitle}</h2>
      {paid ? (
        <p className="mt-1 text-sm text-good">{t.payPaid}</p>
      ) : plan ? (
        <>
          <p className="mt-1 text-sm text-muted">{t.payPrice(som(plan.price), som(plan.maxRows ?? rowCount))}</p>
          <div className="mt-3"><PayButtons planId={plan.id} catalogId={catalogId} providers={providers} /></div>
          <p className="mt-2 text-xs text-muted">{t.payNote}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">{t.payLarge}</p>
      )}
    </section>
  );
}

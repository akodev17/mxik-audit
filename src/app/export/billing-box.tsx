// "Toʻgʻrilangan katalog" payment for this catalogue. Shown only when a
// payment provider is configured; never a pretend checkout.
import { PayButtons } from '@/components/pay-buttons';
import { billingConfig, paymentsEnabled } from '@/lib/billing/config';
import { catalogPaid } from '@/lib/billing/orders';
import { catalogPlan } from '@/lib/billing/plans';
import { t } from '@/lib/i18n';

const som = (n: number): string => n.toLocaleString('uz-UZ');

export async function BillingBox({ orgId, catalogId, rowCount }: { orgId: string; catalogId: string; rowCount: number }) {
  const config = billingConfig();
  if (!paymentsEnabled(config)) return null;
  const paid = await catalogPaid(orgId, catalogId);
  const plan = catalogPlan(rowCount);
  const providers = [config.click ? 'click' as const : null, config.payme ? 'payme' as const : null]
    .filter((p): p is 'click' | 'payme' => p !== null);

  return (
    <section className="mt-6 border border-rule px-5 py-4">
      <h2 className="text-lg">{t.payTitle}</h2>
      {paid ? (
        <p className="mt-1 text-sm text-ok">{t.payPaid}</p>
      ) : plan ? (
        <>
          <p className="mt-1 text-sm text-ink-soft tnum">{t.payPrice(som(plan.price), som(plan.maxRows ?? rowCount))}</p>
          <div className="mt-3"><PayButtons planId={plan.id} catalogId={catalogId} providers={providers} /></div>
          <p className="mt-2 text-xs text-ink-faint">{t.payNote}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">{t.payLarge}</p>
      )}
    </section>
  );
}

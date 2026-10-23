// "Toʻgʻrilangan katalog" payment for this catalogue. Never a pretend checkout: when nothing can be
// paid here it says exactly why (no provider, demo, or only an admin pays). While it is unpaid, it
// also points at the subscriptions, which cover every catalogue.
import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { IconInfo, IconSuccess } from '@/ui/icons';
import { PayButtons } from '@/ui/pay-buttons';

type Props = {
  catalogId: string;
  rowCount: number;
};

/** A compact card for the payment popover: what it costs, how to pay, or why it cannot be paid here. */
export async function BillingBox({ catalogId, rowCount }: Props) {
  const { locale, t, ta } = await getI18n();
  // What this user can buy for this catalogue: only an admin pays, a demo never does, a paid one is said so.
  const { purchase, planId, maxRows } = await serverApi().billing.catalogPurchase({ catalogId });
  const som = (n: number): string => fmtNumber(locale, n);
  return (
    <section aria-labelledby="billing-title" className="space-y-3">
      <h2 id="billing-title" className="text-section">{t.payTitle}</h2>
      {purchase.kind === 'paid' ? (
        <p className="flex items-center gap-1.5 rounded-md bg-good-tint px-3 py-2 text-small font-medium text-good-ink"><IconSuccess size={16} />{t.payPaid}</p>
      ) : null}
      {purchase.kind === 'too_large' ? <p className="text-small text-muted">{t.payLarge}</p> : null}
      {purchase.kind === 'available' ? (
        <>
          <p className="rounded-md bg-surface px-3 py-2.5 text-data font-medium tabular-nums">{t.payPrice(som(purchase.price), som(maxRows ?? rowCount))}</p>
          <PayButtons planId={planId ?? ''} catalogId={catalogId} providers={purchase.providers} />
          <p className="text-micro text-muted">{t.payNote}</p>
        </>
      ) : null}
      {purchase.kind === 'no_provider' || purchase.kind === 'admin_only' || purchase.kind === 'demo' ? (
        <>
          {purchase.kind === 'demo' ? null : <p className="rounded-md bg-surface px-3 py-2.5 text-data font-medium tabular-nums">{t.payPrice(som(purchase.price), som(maxRows ?? rowCount))}</p>}
          <div className="flex gap-2 text-small">
            <IconInfo size={16} className="mt-px shrink-0 text-info-ink" />
            <div className="min-w-0">
              <p className="text-muted">{ta.setX.billing.locked}</p>
              <p className="mt-0.5 text-fg">{ta.setX.billing.why[purchase.kind]}</p>
            </div>
          </div>
        </>
      ) : null}
      {purchase.kind === 'available' || purchase.kind === 'no_provider' || purchase.kind === 'admin_only' ? (
        <p className="text-micro text-muted">
          {ta.setX.billing.subscribe}{' '}
          <Link href="/settings?tab=plan" className="font-medium text-brand-ink underline">{ta.setX.billing.plans}</Link>
        </p>
      ) : null}
    </section>
  );
}

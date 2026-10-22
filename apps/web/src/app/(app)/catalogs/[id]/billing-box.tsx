// "Toʻgʻrilangan katalog" payment for this catalogue. Never a pretend checkout: when nothing can be
// paid here it says exactly why (no provider, demo, or only an admin pays).
import { fmtNumber } from '@tasnivo/i18n/format';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { PayButtons } from '@/ui/pay-buttons';

type Props = {
  catalogId: string;
  rowCount: number;
};

export async function BillingBox({ catalogId, rowCount }: Props) {
  const { locale, t, ta } = await getI18n();
  // What this user can buy for this catalogue: only an admin pays, a demo never does, a paid one is said so.
  const { purchase, planId, maxRows } = await serverApi().billing.catalogPurchase({ catalogId });
  const som = (n: number): string => fmtNumber(locale, n);
  return (
    <section className="space-y-2">
      <h2 className="text-section">{t.payTitle}</h2>
      {purchase.kind === 'paid' ? <p className="text-small text-good-ink">{t.payPaid}</p> : null}
      {purchase.kind === 'too_large' ? <p className="text-small text-muted">{t.payLarge}</p> : null}
      {purchase.kind === 'available' ? (
        <>
          <p className="text-small text-muted">{t.payPrice(som(purchase.price), som(maxRows ?? rowCount))}</p>
          <PayButtons planId={planId ?? ''} catalogId={catalogId} providers={purchase.providers} />
          <p className="text-micro text-muted">{t.payNote}</p>
        </>
      ) : null}
      {purchase.kind === 'no_provider' || purchase.kind === 'admin_only' || purchase.kind === 'demo' ? (
        <>
          <p className="text-small text-muted">{ta.setX.billing.locked}</p>
          {purchase.kind === 'demo' ? null : <p className="text-small text-muted">{t.payPrice(som(purchase.price), som(maxRows ?? rowCount))}</p>}
          <p className="text-small">{ta.setX.billing.why[purchase.kind]}</p>
        </>
      ) : null}
    </section>
  );
}

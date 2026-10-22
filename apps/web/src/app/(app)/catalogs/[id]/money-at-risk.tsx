// Sales of risky rows, when the file had a sales column: an estimate from the
// file's own numbers, labelled as one. No fine or penalty figure is shown here.
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { moneyAtRisk } from '@tasnivo/domain/money-at-risk';

export async function MoneyAtRisk({ catalogId, columnMap }: { catalogId: string; columnMap: unknown }) {
  const { t, locale } = await getI18n();
  const sums = await moneyAtRisk(catalogId, columnMap);
  if (!sums) return null;
  const { risky: riskySum, total: totalSum } = sums;
  const share = fmtNumber(locale, (riskySum / totalSum) * 100, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <section className="no-print mx-4 mt-3 rounded-ctl bg-warn-tint px-4 py-3 md:mx-5">
      <h2 className="text-small font-medium text-warn-ink">{t.moneyTitle}</h2>
      <p className="text-section text-fg">
        {t.moneyRisky(fmtNumber(locale, Math.round(riskySum)))} <span className="text-small font-normal text-muted">{t.moneyShare(share)}</span>
      </p>
      <p className="mt-1 text-micro text-muted">{t.moneyNote}</p>
    </section>
  );
}

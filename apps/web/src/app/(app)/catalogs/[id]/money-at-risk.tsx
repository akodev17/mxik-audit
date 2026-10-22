// Sales of risky rows, when the file had a sales column: an estimate from the
// file's own numbers, labelled as one. No fine or penalty figure is shown here.
import { ColumnMapSchema } from '@/lib/column-map';
import { db } from '@/lib/db';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { RISKY_ITEM } from '@/lib/risk';

export async function MoneyAtRisk({ catalogId, columnMap }: { catalogId: string; columnMap: unknown }) {
  const { t, locale } = await getI18n();
  const mapping = ColumnMapSchema.safeParse(columnMap);
  if (!mapping.success || mapping.data.sales < 0) return null;

  const [risky, total] = await Promise.all([
    db.catalogItem.aggregate({ where: { catalogId, ...RISKY_ITEM }, _sum: { salesAmount: true } }),
    db.catalogItem.aggregate({ where: { catalogId }, _sum: { salesAmount: true } }),
  ]);
  const riskySum = Number(risky._sum.salesAmount ?? 0);
  const totalSum = Number(total._sum.salesAmount ?? 0);
  if (totalSum <= 0) return null;
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

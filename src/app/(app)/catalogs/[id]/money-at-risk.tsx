// Sales of risky rows, when the file had a sales column. An estimate, labelled
// as one; the fine line appears only behind NEXT_PUBLIC_SHOW_LEGAL_223.
import { ColumnMapSchema } from '@/lib/column-map';
import { db } from '@/lib/db';
import { t } from '@/lib/i18n';
import { FINE_223_SOURCE } from '@/lib/legal-sources';
import { RISKY_ITEM } from '@/lib/risk';

const som = (n: number): string => Math.round(n).toLocaleString('uz-UZ');

export async function MoneyAtRisk({ catalogId, columnMap }: { catalogId: string; columnMap: unknown }) {
  const mapping = ColumnMapSchema.safeParse(columnMap);
  if (!mapping.success || mapping.data.sales < 0) return null;

  const [risky, total] = await Promise.all([
    db.catalogItem.aggregate({ where: { catalogId, ...RISKY_ITEM }, _sum: { salesAmount: true } }),
    db.catalogItem.aggregate({ where: { catalogId }, _sum: { salesAmount: true } }),
  ]);
  const riskySum = Number(risky._sum.salesAmount ?? 0);
  const totalSum = Number(total._sum.salesAmount ?? 0);
  if (totalSum <= 0) return null;
  const showFine = process.env['NEXT_PUBLIC_SHOW_LEGAL_223'] === 'true';

  return (
    <section className="no-print mx-5 mt-3 rounded-ctl bg-warn-tint px-4 py-3">
      <h2 className="text-sm font-medium text-warn-ink">{t.moneyTitle}</h2>
      <p className="text-lg font-bold">{t.moneyRisky(som(riskySum))} <span className="text-sm font-normal text-muted">{t.moneyShare(((riskySum / totalSum) * 100).toFixed(1))}</span></p>
      {showFine ? (
        <p className="mt-1 text-sm">
          {t.moneyFine(som(riskySum * 0.01))}{' '}
          <a href={FINE_223_SOURCE.href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline" title={FINE_223_SOURCE.supports}>
            {FINE_223_SOURCE.label}
          </a>
          <span className="block text-xs text-muted">{t.moneyFineNote}</span>
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted">{t.moneyNote}</p>
    </section>
  );
}

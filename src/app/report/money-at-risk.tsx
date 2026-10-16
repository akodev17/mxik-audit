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
    <section className="mt-6 border border-rule px-5 py-4">
      <h2 className="text-sm font-medium text-ink-soft">{t.moneyTitle}</h2>
      <p className="mt-1 font-serif text-2xl tnum">{t.moneyRisky(som(riskySum))}</p>
      <p className="text-sm text-ink-soft tnum">{t.moneyShare(((riskySum / totalSum) * 100).toFixed(1))}</p>
      {showFine ? (
        <p className="mt-2 text-sm tnum">
          {t.moneyFine(som(riskySum * 0.01))}{' '}
          <a href={FINE_223_SOURCE.href} target="_blank" rel="noopener noreferrer" className="underline" title={FINE_223_SOURCE.supports}>
            {FINE_223_SOURCE.label}
          </a>
          <span className="block text-xs text-ink-faint">{t.moneyFineNote}</span>
        </p>
      ) : null}
      <p className="mt-2 text-xs text-ink-faint">{t.moneyNote}</p>
    </section>
  );
}

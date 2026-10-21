import Link from 'next/link';
import type { TypeCount } from '@/lib/dashboard';
import { fmtNumber, fmtPercent } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { issueShares } from '@/lib/work-queue';
import { typeLabels } from '@/ui/labels';
import { RowList } from '@/ui/row-list';

/**
 * Which checks fail most among undecided findings, ranked. Every bar is that check's share of all
 * undecided findings (one scale, 0 to 100%), the count and percentage are printed beside it, and
 * each row opens the review queue filtered by that check.
 */
export async function TopTypes({ types, accountantQuery }: { types: TypeCount[]; accountantQuery: string }) {
  const { locale, t, ta } = await getI18n();
  if (types.length === 0) return <p className="text-small text-muted">{ta.firmX.home.typesNone}</p>;
  const labels = typeLabels(t);
  return (
    <RowList ordered>
      {issueShares(types).map((x) => (
        <li key={x.type} className="py-3">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              href={`/queue?${[`type=${encodeURIComponent(x.type)}`, accountantQuery].filter(Boolean).join('&')}`}
              className="min-w-0 font-medium [overflow-wrap:anywhere] hover:text-brand-ink hover:underline"
            >
              {labels[x.type] ?? x.type}
            </Link>
            <span className="shrink-0 text-small tabular-nums text-muted">
              <span className="font-medium text-fg">{fmtNumber(locale, x.findings)}</span> · {fmtPercent(locale, x.share)}
            </span>
          </div>
          <div aria-hidden className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-warn" style={{ width: `${Math.max(2, Math.round(x.share * 100))}%` }} />
          </div>
          {/* Rows are named only when they differ, so the line never reads "32 · 32". */}
          {x.rows !== x.findings ? <p className="mt-1 text-micro text-muted">{ta.firmX.home.typeRows(fmtNumber(locale, x.rows), x.rows)}</p> : null}
        </li>
      ))}
    </RowList>
  );
}

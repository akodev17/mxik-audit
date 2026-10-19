import Link from 'next/link';
import type { TypeCount } from '@/lib/dashboard';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { typeLabels } from '@/ui/labels';

/** Which checks fail most among undecided findings; each links to the queue filtered by that check. */
export async function TopTypes({ types, accountantQuery }: { types: TypeCount[]; accountantQuery: string }) {
  const { locale, t, ta } = await getI18n();
  if (types.length === 0) return <p className="text-small text-muted">{ta.firmX.home.typesNone}</p>;
  const labels = typeLabels(t);
  const max = Math.max(...types.map((x) => x.findings), 1);
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {types.map((x) => (
        <li key={x.type} className="px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <Link
              href={`/queue?${[`type=${encodeURIComponent(x.type)}`, accountantQuery].filter(Boolean).join('&')}`}
              className="min-w-0 truncate font-medium hover:text-brand-ink hover:underline"
            >
              {labels[x.type] ?? x.type}
            </Link>
            {/* Rows are named only when they differ, so the line never reads "32 · 32". */}
            <span className="shrink-0 text-small text-muted">
              <span className="font-medium tabular-nums text-fg">{ta.firmX.home.typeFindings(fmtNumber(locale, x.findings), x.findings)}</span>
              {x.rows !== x.findings ? <>{' · '}{ta.firmX.home.typeRows(fmtNumber(locale, x.rows), x.rows)}</> : null}
            </span>
          </div>
          <div aria-hidden className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-warn" style={{ width: `${Math.max(2, Math.round((x.findings / max) * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

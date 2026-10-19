import Link from 'next/link';
import { rowProgress, type ClientStats } from '@/lib/client-stats';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { Progress } from '@/ui/progress';

const SHOWN = 5;

/** Clients with the most open risky rows, each linking to its part of the review queue. */
export async function TopRisk({ clients, accountantQuery }: { clients: ClientStats[]; accountantQuery: string }) {
  const { locale, ta } = await getI18n();
  const top = clients.filter((c) => c.openRows > 0).sort((a, b) => b.openRows - a.openRows || a.name.localeCompare(b.name)).slice(0, SHOWN);
  if (top.length === 0) return <p className="text-small text-muted">{ta.firmX.home.topNone}</p>;
  const fmt = (n: number): string => fmtNumber(locale, n);
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {top.map((c) => {
        const progress = rowProgress(c);
        const href = `/queue?${[`client=${encodeURIComponent(c.id)}`, accountantQuery].filter(Boolean).join('&')}`;
        return (
          <li key={c.id} className="px-4 py-3">
            {/* On a phone the count goes under the name, so the name is not cut to a few letters. */}
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
              <Link href={href} className="min-w-0 font-medium [overflow-wrap:anywhere] hover:text-brand-ink hover:underline sm:truncate">{c.name}</Link>
              <span className="text-small font-medium tabular-nums text-danger-ink sm:shrink-0">
                {ta.firmX.home.reasons.open(fmt(c.openRows), c.openRows)}
              </span>
            </div>
            {progress ? (
              <Progress
                className="mt-2" size="sm" tone="good" label={ta.firmX.progress.label}
                value={progress.done} max={progress.total}
                valueText={ta.firmX.progress.of(fmt(progress.done), fmt(progress.total), progress.total)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

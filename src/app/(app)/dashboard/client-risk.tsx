import Link from 'next/link';
import { rowProgress, type ClientStats } from '@/lib/client-stats';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { Progress } from '@/ui/progress';
import { RowList } from '@/ui/row-list';

const SHOWN = 6;
const initials = (name: string): string => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

/** Clients with open risky rows, most first: open count, and how much of their risky rows is reviewed. */
export async function ClientRisk({ clients, accountantQuery }: { clients: ClientStats[]; accountantQuery: string }) {
  const { locale, ta } = await getI18n();
  const top = clients.filter((c) => c.openRows > 0).sort((a, b) => b.openRows - a.openRows || a.name.localeCompare(b.name)).slice(0, SHOWN);
  if (top.length === 0) return <p className="text-small text-muted">{ta.firmX.home.topNone}</p>;
  const fmt = (n: number): string => fmtNumber(locale, n);
  return (
    <RowList>
      {top.map((c) => {
        const progress = rowProgress(c);
        const href = `/queue?${[`client=${encodeURIComponent(c.id)}`, accountantQuery].filter(Boolean).join('&')}`;
        return (
          <li key={c.id} className="flex items-center gap-3 py-3">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-ctl border border-line bg-surface text-small font-medium text-muted">{initials(c.name)}</span>
            <Link href={href} className="min-w-0 flex-1 truncate font-medium hover:text-brand-ink hover:underline" title={c.name}>{c.name}</Link>
            {progress ? <Progress className="hidden w-32 sm:block" size="sm" tone="good" hideLabel label={ta.firmX.progress.label} value={progress.done} max={progress.total} /> : null}
            <span className="w-16 shrink-0 text-right text-data font-medium tabular-nums text-danger-ink" title={ta.firmX.home.reasons.open(fmt(c.openRows), c.openRows)}>{fmt(c.openRows)}<span className="sr-only"> {ta.firmX.home.reasons.open(fmt(c.openRows), c.openRows)}</span></span>
          </li>
        );
      })}
    </RowList>
  );
}

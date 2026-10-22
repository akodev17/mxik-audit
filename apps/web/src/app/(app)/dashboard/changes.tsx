import Link from 'next/link';
import type { Change } from '@/lib/dashboard';
import { fmtDate, fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { StatusChip, StatusIcon } from '@/ui/badge';

/** Clients whose latest upload replaced an earlier version: risky rows before and after. */
export async function Changes({ changes }: { changes: Change[] }) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  if (changes.length === 0) return <p className="text-small text-muted">{home.changesNone}</p>;
  const fmt = (n: number): string => fmtNumber(locale, n);
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {changes.map((c) => {
        const delta = c.after - c.before;
        const chip = delta < 0
          ? <StatusChip tone="good" icon={<StatusIcon tone="good" size={12} />}>{home.changeFewer(fmt(-delta), -delta)}</StatusChip>
          : delta > 0
            ? <StatusChip tone="danger" icon={<StatusIcon tone="danger" size={12} />}>{home.changeMore(fmt(delta), delta)}</StatusChip>
            : <StatusChip tone="neutral">{home.changeSame}</StatusChip>;
        return (
          <li key={c.catalogId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
            <span className="min-w-0">
              <Link href={`/clients/${c.clientId}`} className="font-medium hover:text-brand-ink hover:underline">{c.clientName}</Link>
              <span className="mt-0.5 flex flex-wrap items-center gap-2 text-small text-muted">
                <span>{fmtDate(locale, c.auditedAt)}</span>
                <span className="tabular-nums">{fmt(c.before)} → {fmt(c.after)}</span>
                {chip}
              </span>
            </span>
            <Link href={`/catalogs/${c.catalogId}/diff`} className="text-small font-medium text-brand-ink hover:underline">{home.changesDiff}</Link>
          </li>
        );
      })}
    </ul>
  );
}

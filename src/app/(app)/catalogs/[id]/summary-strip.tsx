'use client';

import { useI18n } from '@/lib/locale-client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { WsSummary } from '@/lib/workspace';
import { Badge } from '@/ui/badge';
import { typeLabels } from '@/ui/labels';

const CHIP_TYPES = ['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT', 'NOT_PURCHASED', 'PRIVILEGE_CODE', 'PRIVILEGE_OPPORTUNITY'] as const;

type Props = { summary: WsSummary; reviewedDelta: number; activeType: string | null };

const fmt = (n: number): string => n.toLocaleString('uz-UZ');

/** Counts, one chip per finding type (chips are the filters) and review progress. */
export function SummaryStrip({ summary, reviewedDelta, activeType }: Props) {
  const { t, ta } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (type: string | null): string => {
    const next = new URLSearchParams(params.toString());
    if (type) next.set('type', type); else next.delete('type');
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const reviewed = Math.max(0, Math.min(summary.riskyFindings, summary.reviewed + reviewedDelta));
  const pct = summary.riskyFindings === 0 ? 100 : Math.round((reviewed / summary.riskyFindings) * 100);

  const chip = (key: string | null, label: string, count: number) => (
    <Link
      key={key ?? 'all'} href={href(key)} scroll={false} replace
      aria-pressed={activeType === key}
      className={`inline-flex h-8 items-center gap-2 rounded-ctl border px-3 text-sm font-medium transition-colors ${activeType === key ? 'border-brand bg-brand-tint text-brand' : 'border-line-strong bg-base hover:bg-surface'}`}
    >
      {label}
      <Badge tone={activeType === key ? 'brand' : 'neutral'}>{fmt(count)}</Badge>
    </Link>
  );

  return (
    <section className="no-print border-b border-line px-5 py-3" aria-label={ta.shell.summary}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <dl className="flex items-baseline gap-5">
          <div><dt className="text-xs text-muted">{ta.ws.rows}</dt><dd className="text-xl font-bold">{fmt(summary.total)}</dd></div>
          <div><dt className="text-xs text-muted">{ta.ws.risky}</dt><dd className={`text-xl font-bold ${summary.riskyRows > 0 ? 'text-danger' : 'text-good'}`}>{fmt(summary.riskyRows)}</dd></div>
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          {chip(null, ta.ws.allRows, summary.riskyFindings)}
          {CHIP_TYPES.filter((type) => (summary.byType[type] ?? 0) > 0).map((type) => chip(type, typeLabels(t)[type] ?? type, summary.byType[type] ?? 0))}
          {summary.markingTotal > 0 ? chip('MARKING', ta.ws.marking, summary.markingTotal) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 w-full max-w-md overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={ta.ws.reviewed}>
          <div className="h-full rounded-full bg-good transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-sm text-muted">{ta.ws.progress(reviewed, summary.riskyFindings)}</span>
      </div>
    </section>
  );
}

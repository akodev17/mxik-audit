'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { fmtNumber } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import type { WsSummary } from '@/lib/workspace';
import { FINDING_TYPES } from '@/lib/workspace-filter';
import { Badge } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { typeLabels } from '@/ui/labels';
import { Progress } from '@/ui/progress';
import { count } from './ws-text';

type Props = { summary: WsSummary; reviewedDelta: number; activeType: string | null };

/**
 * Rows ("qator") and findings ("muammo") are different counts and are labelled
 * so: a row can carry several findings. Chips filter by finding type.
 */
export function SummaryStrip({ summary, reviewedDelta, activeType }: Props) {
  const { t, ta, locale } = useI18n();
  const x = ta.wsX;
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (type: string | null): string => {
    const next = new URLSearchParams(params.toString());
    if (type) next.set('type', type); else next.delete('type');
    next.set('v', '0');
    return `${pathname}?${next.toString()}`;
  };
  const reviewed = Math.max(0, Math.min(summary.riskyFindings, summary.reviewed + reviewedDelta));
  const num = (n: number): string => fmtNumber(locale, n);
  const progressText = x.count.progress(num(reviewed), num(summary.riskyFindings), summary.riskyFindings);

  const chip = (key: string | null, label: string, n: number, unit: typeof x.count.findings = x.count.findings) => (
    <Link
      key={key ?? 'all'} href={href(key)} scroll={false} replace
      aria-current={activeType === key ? 'true' : undefined}
      aria-label={`${label}: ${count(locale, unit, n)}`}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-2 rounded-ctl border px-3 text-small font-medium transition-colors duration-(--duration-fast)',
        activeType === key ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface',
      )}
    >
      {label}
      <Badge tone={activeType === key ? 'brand' : 'neutral'}>{num(n)}</Badge>
    </Link>
  );

  return (
    <section className="no-print border-b border-line px-4 py-3 md:px-5" aria-label={ta.shell.summary}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <dl className="flex items-baseline gap-4 md:gap-5">
          <div><dt className="text-micro text-muted">{x.kpi.total}</dt><dd className="text-section tabular-nums text-fg">{num(summary.total)}</dd></div>
          <div title={x.kpi.riskyRowsHint}>
            <dt className="text-micro text-muted">{x.kpi.riskyRows}</dt>
            <dd className={cx('text-section tabular-nums', summary.riskyRows > 0 ? 'text-danger-ink' : 'text-good-ink')}>{num(summary.riskyRows)}</dd>
          </div>
          <div><dt className="text-micro text-muted">{x.kpi.findings}</dt><dd className="text-section tabular-nums text-fg">{num(summary.riskyFindings)}</dd></div>
        </dl>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-small text-fg" aria-hidden>{progressText}</span>
          <Progress
            className="w-56 max-w-full" size="sm" tone="good" hideLabel
            label={ta.ws.reviewed} value={reviewed} max={Math.max(1, summary.riskyFindings)} valueText={progressText}
          />
        </div>
      </div>
      <nav aria-label={x.kpi.chipsLabel} className="mt-3 flex w-full min-w-0 gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
        {chip(null, x.kpi.all, summary.riskyFindings)}
        {FINDING_TYPES.filter((type) => (summary.byType[type] ?? 0) > 0).map((type) => chip(type, typeLabels(t)[type] ?? type, summary.byType[type] ?? 0))}
        {summary.markingTotal > 0 ? chip('MARKING', ta.ws.marking, summary.markingTotal, x.count.rows) : null}
      </nav>
    </section>
  );
}

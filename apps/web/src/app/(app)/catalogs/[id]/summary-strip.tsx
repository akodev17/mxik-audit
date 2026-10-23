'use client';

import { fmtNumber } from '@tasnivo/i18n/format';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import type { WsSummary } from './ws-types';
import { cx } from '@/ui/cx';
import { Progress, progressPercent } from '@/ui/progress';
import { InfoHint } from './info-hint';

type Props = { summary: WsSummary; reviewedDelta: number };

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: 'danger' | 'good'; hint?: ReactNode }) {
  return (
    <div className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-raised pl-3 pr-2.5">
      <dt className="flex items-center gap-0.5 text-small text-muted">{label}{hint}</dt>
      <dd className={cx('text-data font-semibold tabular-nums', tone === 'danger' ? 'text-danger-ink' : tone === 'good' ? 'text-good-ink' : 'text-fg')}>{value}</dd>
    </div>
  );
}

/**
 * The catalogue at a glance: rows, risky rows and findings as KPI chips, and review progress as a
 * bar. Rows ("qator") and findings ("muammo") are different counts and are labelled so: a row can
 * carry several findings. The filter chips by finding type sit under the toolbar (FilterChips).
 */
export function SummaryStrip({ summary, reviewedDelta }: Props) {
  const { ta, locale } = useI18n();
  const x = ta.wsX;
  const u = ta.wsUi.kpi;
  const reviewed = Math.max(0, Math.min(summary.riskyFindings, summary.reviewed + reviewedDelta));
  const num = (n: number): string => fmtNumber(locale, n);
  const progressText = x.count.progress(num(reviewed), num(summary.riskyFindings), summary.riskyFindings);
  const max = Math.max(1, summary.riskyFindings);
  const percent = progressPercent(reviewed, max);

  return (
    <section className="no-print border-b border-line px-4 py-2.5 md:px-5" aria-label={ta.shell.summary}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex flex-wrap items-center gap-2" aria-label={u.label}>
          <Kpi label={x.kpi.total} value={num(summary.total)} />
          <Kpi
            label={x.kpi.riskyRows} value={num(summary.riskyRows)} tone={summary.riskyRows > 0 ? 'danger' : 'good'}
            hint={<InfoHint text={x.kpi.riskyRowsHint} label={`${x.kpi.riskyRows}: ${x.header.more}`} />}
          />
          <Kpi label={x.kpi.findings} value={num(summary.riskyFindings)} />
        </dl>
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none md:ml-auto">
          <span className="shrink-0 text-small text-muted" aria-hidden>{u.reviewed}</span>
          <Progress
            className="w-full min-w-24 sm:w-48" size="sm" tone="good" hideLabel
            label={ta.ws.reviewed} value={reviewed} max={max} valueText={progressText}
          />
          <span className="shrink-0 text-small tabular-nums text-fg" aria-hidden>
            <span className="font-semibold">{num(reviewed)}</span><span className="text-muted"> / {num(summary.riskyFindings)}</span>
            <span className="ml-2 text-muted">{u.percent(num(percent))}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

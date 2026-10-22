'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fmtNumber } from '@/lib/format';
import { useI18n } from '@/lib/locale-client';
import type { ChipCounts, WsSummary } from '@/lib/workspace';
import { FINDING_TYPES } from '@/lib/workspace-filter';
import { Badge } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { typeLabels } from '@/ui/labels';
import { Progress } from '@/ui/progress';
import { InfoHint } from './info-hint';
import { count } from './ws-text';

type Props = { summary: WsSummary; chips: ChipCounts; reviewedDelta: number; activeType: string | null };

/** True while the chip row hides chips past its right edge (phones scroll it sideways). */
function useMoreRight(): [React.RefObject<HTMLElement | null>, boolean] {
  const ref = useRef<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { el.removeEventListener('scroll', measure); observer.disconnect(); };
  }, []);
  return [ref, more];
}

/**
 * Rows ("qator") and findings ("muammo") are different counts and are labelled
 * so: a row can carry several findings. Chips filter by finding type; each
 * counts what its list will show under the current decision and flag filters.
 */
export function SummaryStrip({ summary, chips, reviewedDelta, activeType }: Props) {
  const { t, ta, locale } = useI18n();
  const x = ta.wsX;
  const pathname = usePathname();
  const params = useSearchParams();
  const [chipRow, moreRight] = useMoreRight();
  const href = (type: string | null): string => {
    const next = new URLSearchParams(params.toString());
    if (type) next.set('type', type); else next.delete('type');
    next.set('v', '0');
    return `${pathname}?${next.toString()}`;
  };
  const reviewed = Math.max(0, Math.min(summary.riskyFindings, summary.reviewed + reviewedDelta));
  const num = (n: number): string => fmtNumber(locale, n);
  const progressText = x.count.progress(num(reviewed), num(summary.riskyFindings), summary.riskyFindings);

  const chip = (key: string | null, label: string, n: number) => (
    <Link
      key={key ?? 'all'} href={href(key)} scroll={false} replace
      aria-current={activeType === key ? 'true' : undefined}
      aria-label={`${label}: ${count(locale, x.count.findings, n)}`}
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
    <section className="no-print border-b border-line px-4 py-2 md:px-5" aria-label={ta.shell.summary}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex items-baseline gap-4 md:gap-5">
          <div><dt className="text-micro text-muted">{x.kpi.total}</dt><dd className="text-section tabular-nums text-fg">{num(summary.total)}</dd></div>
          <div>
            <dt className="flex items-center gap-0.5 text-micro text-muted">{x.kpi.riskyRows}<InfoHint text={x.kpi.riskyRowsHint} label={`${x.kpi.riskyRows}: ${x.header.more}`} /></dt>
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
        <div className="relative min-w-0 max-w-full basis-full">
          <nav ref={chipRow} aria-label={x.kpi.chipsLabel} className="flex w-full min-w-0 gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
            {chip(null, x.kpi.all, chips.all)}
            {FINDING_TYPES.filter((type) => (summary.byType[type] ?? 0) > 0).map((type) => chip(type, typeLabels(t)[type] ?? type, chips.byType[type] ?? 0))}
            {summary.markingTotal > 0 ? chip('MARKING', ta.ws.marking, chips.marking) : null}
          </nav>
          <span aria-hidden className={cx('pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-base to-transparent transition-opacity duration-(--duration-fast) md:hidden', moreRight ? 'opacity-100' : 'opacity-0')} />
        </div>
      </div>
    </section>
  );
}

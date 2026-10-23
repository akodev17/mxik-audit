import Link from 'next/link';
import type { ReactNode } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { openRowsHint, reviewedShare } from '@/lib/pure/client-kpi';
import { cx } from '@/ui/cx';
import { IconChevron, IconSuccess, IconUsers } from '@/ui/icons';
import { Progress } from '@/ui/progress';
import { IconClock, IconFlag } from '@/ui/shell/icons';
import type { Change, Totals } from './dashboard-data';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';

type Kpi = {
  key: string;
  label: string;
  value: string;
  unit?: string;
  hint: ReactNode;
  href: string;
  tone: Tone;
  icon: ReactNode;
  bar?: { done: number; total: number };
  delta?: ReactNode;
};

const CHIP: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted',
  good: 'bg-good-tint text-good-ink',
  warn: 'bg-warn-tint text-warn-ink',
  danger: 'bg-danger-tint text-danger-ink',
};
const VALUE: Record<Tone, string> = { neutral: 'text-fg', good: 'text-good-ink', warn: 'text-warn-ink', danger: 'text-danger-ink' };

/** Risky rows after minus before, over the clients whose latest upload replaced an earlier version. */
export function riskDelta(changes: readonly Pick<Change, 'before' | 'after'>[]): number {
  return changes.reduce((n, c) => n + (c.after - c.before), 0);
}

/**
 * The four measures at the top of the dashboard, as cards: what is counted (label and icon), the number,
 * one line of context and, on the first, the change since the previous versions. The first card (open
 * risky rows: the work itself) is wider and its number carries the status colour; every card links to the
 * list behind its number.
 */
export async function Summary({ totals, reviewed, audited, queueHref, awaiting, changes }: {
  totals: Totals; reviewed: { done: number; total: number } | null; audited: boolean; queueHref: string;
  /** Clients whose latest catalogue still has open risky rows: the catalogues waiting for review. */
  awaiting: number;
  changes: readonly Change[];
}) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const delta = riskDelta(changes);
  const items: Kpi[] = [
    {
      key: 'open', label: home.openRows, value: fmt(totals.openRows), href: queueHref, icon: <IconFlag size={16} />,
      tone: totals.openRows > 0 ? 'danger' : 'good',
      hint: awaiting > 0 ? home.awaitingCatalogs(fmt(awaiting), awaiting) : openRowsHint(locale, ta.firmX.progress, totals.openRows, totals.pendingFindings),
      delta: delta !== 0 ? (
        <span title={home.kpiDeltaLabel} className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-micro font-medium tabular-nums', delta < 0 ? CHIP.good : CHIP.danger)}>
          {home.kpiDelta(fmt(Math.abs(delta)), delta > 0)}
        </span>
      ) : undefined,
    },
    {
      key: 'reviewed', label: ta.firmX.progress.label, href: '/clients?sort=progress', icon: <IconSuccess size={16} />,
      tone: reviewed && reviewed.done === reviewed.total ? 'good' : 'neutral',
      value: reviewed ? fmt(reviewed.done) : ta.firmX.dash, unit: reviewed ? `/ ${fmt(reviewed.total)}` : undefined,
      hint: reviewed ? reviewedShare(locale, ta.firmX.progress, reviewed) : audited ? ta.firmX.progress.none : ta.firmX.progress.notAudited,
      bar: reviewed ?? undefined,
    },
    {
      key: 'attention', label: home.attention, value: fmt(totals.attention), href: '/clients?filter=attention', icon: <IconUsers size={16} />,
      tone: totals.attention > 0 ? 'warn' : 'good', hint: home.activeClients(fmt(totals.attention), fmt(totals.clients), totals.clients),
    },
    {
      key: 'overdue', label: home.overdue, value: fmt(totals.overdueTasks), href: '/clients?filter=overdue', icon: <IconClock size={16} />,
      tone: totals.overdueTasks > 0 ? 'danger' : 'neutral', hint: home.overdueHint,
    },
  ];

  return (
    <ul aria-label={ta.dash.title} className="grid grid-cols-2 gap-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
      {items.map((item, i) => {
        const primary = i === 0;
        return (
          <li key={item.key} className={cx('min-w-0', primary && 'col-span-2 lg:col-span-1')}>
            <Link
              href={item.href}
              className={cx(
                'group/kpi flex h-full min-w-0 flex-col rounded-lg border border-line bg-raised p-4 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-line-strong hover:shadow-sm sm:p-5',
              )}
            >
              <span className="flex items-center gap-2.5">
                <span aria-hidden className={cx('size-7 shrink-0 place-items-center rounded-md', primary ? 'grid' : 'hidden min-[420px]:grid', CHIP[item.tone])}>{item.icon}</span>
                <span className="line-clamp-2 min-w-0 flex-1 text-small font-medium leading-tight text-muted" title={item.label}>{item.label}</span>
                <IconChevron size={14} className="shrink-0 text-subtle transition-transform duration-(--duration-fast) group-hover/kpi:translate-x-0.5 motion-reduce:transition-none" />
              </span>
              <span className="mt-3 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                <span className={cx('text-[1.75rem] font-semibold leading-8 tracking-tight tabular-nums', primary ? VALUE[item.tone] : 'text-fg', primary && 'sm:text-[2rem] sm:leading-9')}>{item.value}</span>
                {item.unit ? <span className="text-small tabular-nums text-muted">{item.unit}</span> : null}
                {item.delta ? <span className="ml-1 self-center">{item.delta}</span> : null}
              </span>
              {item.bar ? (
                <span className="mt-2.5 block">
                  <Progress size="sm" tone="good" hideLabel label={item.label} value={item.bar.done} max={item.bar.total} />
                </span>
              ) : null}
              <span className="mt-auto block pt-2 text-small text-muted">{item.hint}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

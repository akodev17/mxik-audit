import Link from 'next/link';
import type { ReactNode } from 'react';
import { openRowsHint, reviewedShare } from '@/lib/client-kpi';
import type { Totals } from '@/lib/dashboard';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { cx } from '@/ui/cx';
import { IconChevron } from '@/ui/icons';
import { Progress } from '@/ui/progress';

type Tone = 'neutral' | 'good' | 'warn' | 'danger';
const VALUE: Record<Tone, string> = { neutral: 'text-fg', good: 'text-good-ink', warn: 'text-warn-ink', danger: 'text-danger-ink' };

type Cell = { key: string; label: string; value: ReactNode; unit?: string; hint?: ReactNode; href: string; tone: Tone; bar?: { done: number; total: number } };

/**
 * Four measures in one ruled strip instead of four separate tiles: rows to review, rows reviewed,
 * clients needing attention, overdue checks. Each says what it counts (rows, clients, checks) and
 * links to the list behind it.
 */
export async function Summary({ totals, reviewed, audited, queueHref }: {
  totals: Totals; reviewed: { done: number; total: number } | null; audited: boolean; queueHref: string;
}) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const cells: Cell[] = [
    {
      key: 'open', label: home.openRows, value: fmt(totals.openRows), href: queueHref,
      tone: totals.openRows > 0 ? 'danger' : 'good',
      hint: openRowsHint(locale, ta.firmX.progress, totals.openRows, totals.pendingFindings),
    },
    {
      key: 'reviewed', label: ta.firmX.progress.label, href: '/clients?sort=progress', tone: 'neutral',
      value: reviewed ? fmt(reviewed.done) : ta.firmX.dash,
      unit: reviewed ? `/ ${fmt(reviewed.total)}` : undefined,
      hint: reviewed ? reviewedShare(locale, ta.firmX.progress, reviewed) : audited ? ta.firmX.progress.none : ta.firmX.progress.notAudited,
      bar: reviewed ?? undefined,
    },
    {
      key: 'attention', label: home.attention, value: fmt(totals.attention), href: '/clients?filter=attention',
      tone: totals.attention > 0 ? 'warn' : 'good', hint: home.attentionHint(fmt(totals.clients), totals.clients),
    },
    {
      key: 'overdue', label: home.overdue, value: fmt(totals.overdueTasks), href: '/clients?filter=overdue',
      tone: totals.overdueTasks > 0 ? 'danger' : 'neutral', hint: home.overdueHint,
    },
  ];
  return (
    <ul aria-label={ta.dash.title} className="grid grid-cols-2 gap-px overflow-hidden rounded-ctl border border-line bg-line lg:grid-cols-4">
      {cells.map((c) => (
        <li key={c.key} className="min-w-0 bg-raised">
          <Link href={c.href} className={cx('group flex h-full flex-col px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-surface')}>
            <span className="flex items-start justify-between gap-2 text-small text-muted">
              <span className="line-clamp-2 min-w-0" title={c.label}>{c.label}</span>
              <IconChevron size={14} className="mt-0.5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
            <span className="mt-auto flex items-baseline gap-1.5 pt-1">
              <span className={cx('text-title tabular-nums', VALUE[c.tone])}>{c.value}</span>
              {c.unit ? <span className="text-small tabular-nums text-muted">{c.unit}</span> : null}
            </span>
            {c.bar ? <Progress className="mt-1.5" size="sm" tone="good" hideLabel label={c.label} value={c.bar.done} max={c.bar.total} /> : null}
            {c.hint ? <span className="mt-1 block text-micro text-muted">{c.hint}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

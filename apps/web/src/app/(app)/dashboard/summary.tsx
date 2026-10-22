import { openRowsHint, reviewedShare } from '@/lib/client-kpi';
import type { Totals } from '@/lib/dashboard';
import { fmtNumber } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { StatRow, type StatRowItem } from '@/ui/stat-row';

/**
 * Four measures in one hairline-divided row: rows to review, rows reviewed, clients needing
 * attention, overdue checks. Each says what it counts and links to the list behind it.
 */
export async function Summary({ totals, reviewed, audited, queueHref, awaiting }: {
  totals: Totals; reviewed: { done: number; total: number } | null; audited: boolean; queueHref: string;
  /** Clients whose latest catalogue still has open risky rows: the catalogues waiting for review. */
  awaiting: number;
}) {
  const { locale, ta } = await getI18n();
  const home = ta.firmX.home;
  const fmt = (n: number): string => fmtNumber(locale, n);
  const items: StatRowItem[] = [
    {
      key: 'open', label: home.openRows, value: fmt(totals.openRows), href: queueHref,
      tone: totals.openRows > 0 ? 'danger' : 'good',
      hint: awaiting > 0 ? home.awaitingCatalogs(fmt(awaiting), awaiting) : openRowsHint(locale, ta.firmX.progress, totals.openRows, totals.pendingFindings),
    },
    {
      key: 'reviewed', label: ta.firmX.progress.label, href: '/clients?sort=progress',
      value: reviewed ? fmt(reviewed.done) : ta.firmX.dash, unit: reviewed ? `/ ${fmt(reviewed.total)}` : undefined,
      hint: reviewed ? reviewedShare(locale, ta.firmX.progress, reviewed) : audited ? ta.firmX.progress.none : ta.firmX.progress.notAudited,
      bar: reviewed ?? undefined,
    },
    {
      key: 'attention', label: home.attention, value: fmt(totals.attention), href: '/clients?filter=attention',
      tone: totals.attention > 0 ? 'warn' : 'good', hint: home.activeClients(fmt(totals.attention), fmt(totals.clients), totals.clients),
    },
    {
      key: 'overdue', label: home.overdue, value: fmt(totals.overdueTasks), href: '/clients?filter=overdue',
      tone: totals.overdueTasks > 0 ? 'danger' : 'neutral', hint: home.overdueHint,
    },
  ];
  return <StatRow items={items} label={ta.dash.title} size="lg" bare />;
}

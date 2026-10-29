import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { StatRow, type StatRowItem } from '@/ui/stat-row';
import { Card } from './card';
import type { Value } from './dashboard-data';

/**
 * What the firm's audits produced for the clients shown (F10), every audited version counted: rows
 * checked (failed rows apart), issues found and resolved, decisions, and time saved. Time saved is
 * decisions × the org's minutes per decision and says so next to the number (D8); an admin's tile
 * opens the setting.
 */
export async function ValueSummary({ value, canEditMinutes }: { value: Value; canEditMinutes: boolean }) {
  const { locale, ta } = await getI18n();
  const v = ta.firmX.value;
  const n = (x: number): string => fmtNumber(locale, x);
  const hours = fmtNumber(locale, value.minutesSaved / 60, { maximumFractionDigits: 1 });
  const items: StatRowItem[] = [
    {
      key: 'rows', label: v.rows, value: n(value.rowsChecked), href: '/catalogs',
      hint: (
        <>
          {v.rowsHint(n(value.catalogs), value.catalogs)}
          {value.rowsFailed > 0 ? <span className="block text-danger-ink">{v.rowsFailed(n(value.rowsFailed), value.rowsFailed)}</span> : null}
        </>
      ),
    },
    {
      key: 'issues', label: v.issues, value: n(value.issues), hint: v.issuesHint(n(value.resolved), value.resolved),
      bar: value.issues > 0 ? { done: value.resolved, total: value.issues } : undefined,
      tone: value.issues > 0 && value.resolved === value.issues ? 'good' : 'neutral',
    },
    {
      key: 'decisions', label: v.decisions, value: n(value.decisions), href: '/activity?category=decisions',
      hint: v.decisionsHint(n(value.autoDecisions), value.autoDecisions),
    },
    {
      key: 'saved', label: v.saved, value: v.hours(hours), href: canEditMinutes ? '/settings#minutes' : undefined,
      hint: v.savedHint(n(value.decisions), n(value.minutesPerDecision)),
    },
  ];
  return (
    <Card id="value" title={v.title} hint={v.hint}>
      <StatRow items={items} label={v.label} bare />
    </Card>
  );
}

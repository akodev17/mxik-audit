import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { Progress } from '@/ui/progress';
import { meterTone } from './plan-meter';

export type PlanStatus = OutputOf<typeof endpoints.billing.plan>['status'];
type Meter = { key: 'clients' | 'rowsPerMonth' | 'seats' | 'apiChecks'; used: number; cap: number | null };

/** Usage against each limit as a grid of meters; nothing for an account without limits. */
export async function PlanUsage({ status, apiChecks }: { status: PlanStatus; apiChecks: { used: number; cap: number | null } }) {
  const { locale, ta } = await getI18n();
  const s = ta.setX.plan;
  if (status.state === 'unlimited') return null;
  const n = (v: number): string => fmtNumber(locale, v);
  const meters: Meter[] = [
    { key: 'clients', used: status.usage.clients, cap: status.limits.clients },
    { key: 'rowsPerMonth', used: status.usage.rowsPerMonth, cap: status.limits.rowsPerMonth },
    { key: 'seats', used: status.usage.seats, cap: status.limits.seats },
    { key: 'apiChecks', used: apiChecks.used, cap: apiChecks.cap },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-small font-semibold">{s.usage}</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {meters.map((m) => (
          <li key={m.key} className="relative rounded-md border border-line bg-surface px-3.5 py-3">
            {m.cap === null ? (
              <div className="flex items-baseline justify-between gap-3 text-small">
                <span className="text-muted">{s.keys[m.key]}</span>
                <span className="font-medium tabular-nums">{s.noCap(n(m.used))}</span>
              </div>
            ) : (
              <Progress label={s.keys[m.key]} value={Math.min(m.used, m.cap)} max={Math.max(m.cap, 1)} valueText={s.of(n(m.used), n(m.cap))} tone={meterTone(m.used, m.cap)} size="sm" />
            )}
          </li>
        ))}
      </ul>
      <p className="text-micro text-muted">{s.usageHint}</p>
    </div>
  );
}

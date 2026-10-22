import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { meterTone } from './plan-meter';

export type PlanStatus = OutputOf<typeof endpoints.billing.plan>['status'];
type Meter = { key: 'clients' | 'rowsPerMonth' | 'seats' | 'apiChecks'; used: number; cap: number | null };

const STATE_TONE: Record<PlanStatus['state'], Tone> = { unlimited: 'neutral', trial: 'info', firm: 'good', expired: 'danger' };

/** The plan's state in one line (no repeated label), then usage against each limit. */
export async function PlanUsage({ status, until, apiChecks }: { status: PlanStatus; until: string | null; apiChecks: { used: number; cap: number | null } }) {
  const { locale, ta } = await getI18n();
  const s = ta.setX.plan;
  const n = (v: number): string => fmtNumber(locale, v);
  const detail = status.state === 'trial' && status.daysLeft !== null && status.trialEndsAt
    ? s.trialLeft(status.daysLeft, fmtDate(locale, status.trialEndsAt))
    : status.state === 'firm' && until ? s.firmUntil(fmtDate(locale, until))
    : status.state === 'expired' ? s.expiredText
    : status.state === 'unlimited' ? s.unlimitedText : null;
  const meters: Meter[] = [
    { key: 'clients', used: status.usage.clients, cap: status.limits.clients },
    { key: 'rowsPerMonth', used: status.usage.rowsPerMonth, cap: status.limits.rowsPerMonth },
    { key: 'seats', used: status.usage.seats, cap: status.limits.seats },
    { key: 'apiChecks', used: apiChecks.used, cap: apiChecks.cap },
  ];
  const tone = STATE_TONE[status.state];

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <StatusChip tone={tone} icon={<StatusIcon tone={tone} />}>{s.states[status.state]}</StatusChip>
        {detail ? <p className="max-w-xl text-small text-muted">{detail}</p> : null}
      </div>
      {status.state === 'unlimited' ? null : (
        <div className="max-w-xl space-y-3">
          <h3 className="text-small font-semibold">{s.usage}</h3>
          <ul className="space-y-3">
            {meters.map((m) => (
              <li key={m.key}>
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
      )}
    </div>
  );
}

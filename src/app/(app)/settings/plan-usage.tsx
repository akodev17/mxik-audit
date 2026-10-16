import { getI18n } from '@/lib/locale';
import type { PlanStatus } from '@/lib/plan';

const KEYS = ['clients', 'rowsPerMonth', 'seats'] as const;

/** State of the plan and usage against each limit. */
export async function PlanUsage({ status, until }: { status: PlanStatus; until: string | null }) {
  const { ta } = await getI18n();
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {ta.plan.stateLabel[status.state]}
        {status.state === 'trial' && status.daysLeft !== null ? `: ${ta.plan.trial(status.daysLeft)}` : ''}
        {status.state === 'firm' && until ? `: ${ta.plan.until(until)}` : ''}
      </p>
      <ul className="space-y-2">
        {KEYS.map((k) => {
          const cap = status.limits[k];
          const used = status.usage[k];
          const pct = cap === null || cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));
          const bar = pct >= 100 ? 'bg-danger' : pct >= 80 ? 'bg-warn' : 'bg-good';
          return (
            <li key={k} className="text-sm">
              <div className="flex justify-between"><span>{ta.plan.keys[k]}</span><span className="text-muted">{used.toLocaleString('uz-UZ')} / {cap === null ? ta.plan.unlimited : cap.toLocaleString('uz-UZ')}</span></div>
              {cap === null ? null : <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

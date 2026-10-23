import Link from 'next/link';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { Progress } from '@/ui/progress';
import { WARN_AT } from '../settings/plan-meter';
import { Card, FOOT_LINK } from './card';

type Key = 'clients' | 'rowsPerMonth' | 'seats';
const KEYS: Key[] = ['clients', 'rowsPerMonth', 'seats'];

/**
 * Usage against the plan's limits, for the limits that exist; nothing at all when the plan has none.
 * On a trial it also says how many days are left from the first day (the shell banner only warns in
 * the last five).
 */
export async function UsagePanel({ status }: { status: { state?: string; daysLeft?: number | null; limits: Record<Key, number | null>; usage: Record<Key, number> } }) {
  const { locale, ta } = await getI18n();
  const meters = KEYS.flatMap((key) => {
    const cap = status.limits[key];
    return cap === null ? [] : [{ key, used: status.usage[key], cap }];
  });
  if (meters.length === 0) return null;
  const n = (v: number): string => fmtNumber(locale, v);
  return (
    <Card id="usage" title={ta.setX.tabs.plan} footer={<Link href="/settings?tab=plan" className={FOOT_LINK}>{ta.setX.plan.current}</Link>}>
      <div className="space-y-4 pt-1">
        {status.state === 'trial' && status.daysLeft != null ? <p className="text-small text-muted">{ta.plan.trial(status.daysLeft)}</p> : null}
        {meters.map((m) => (
          <Progress
            key={m.key} size="sm" label={ta.setX.plan.rows[m.key]} value={m.used} max={m.cap} valueText={`${n(m.used)} / ${n(m.cap)}`}
            tone={m.used >= m.cap ? 'danger' : m.used >= m.cap * WARN_AT ? 'warn' : 'brand'}
          />
        ))}
      </div>
    </Card>
  );
}

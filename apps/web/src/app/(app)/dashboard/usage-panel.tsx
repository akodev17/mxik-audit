import Link from 'next/link';
import { WARN_AT } from '@tasnivo/domain/billing/limits';
import { fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { Progress } from '@/ui/progress';

type Key = 'clients' | 'rowsPerMonth' | 'seats';
const KEYS: Key[] = ['clients', 'rowsPerMonth', 'seats'];

/** Usage against the plan's limits, for the limits that exist; nothing at all when the plan has none. */
export async function UsagePanel({ status }: { status: { limits: Record<Key, number | null>; usage: Record<Key, number> } }) {
  const { locale, ta } = await getI18n();
  const meters = KEYS.flatMap((key) => {
    const cap = status.limits[key];
    return cap === null ? [] : [{ key, used: status.usage[key], cap }];
  });
  if (meters.length === 0) return null;
  const n = (v: number): string => fmtNumber(locale, v);
  return (
    <section aria-labelledby="usage-title">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="usage-title" className="text-[1.125rem] font-medium leading-6">{ta.setX.tabs.plan}</h2>
        <Link href="/settings?tab=plan" className="text-small font-medium text-brand-ink hover:underline">{ta.setX.plan.current}</Link>
      </div>
      <div className="mt-4 space-y-4">
        {meters.map((m) => (
          <Progress
            key={m.key} size="sm" label={ta.setX.plan.rows[m.key]} value={m.used} max={m.cap} valueText={`${n(m.used)} / ${n(m.cap)}`}
            tone={m.used >= m.cap ? 'danger' : m.used >= m.cap * WARN_AT ? 'warn' : 'brand'}
          />
        ))}
      </div>
    </section>
  );
}

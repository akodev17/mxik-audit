import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { cx } from '@/ui/cx';
import { Card } from './card';
import type { WeekCount } from './dashboard-data';

/** dd.mm of a YYYY-MM-DD week start. */
const dayMonth = (locale: Parameters<typeof fmtDate>[0], weekStart: string): string => fmtDate(locale, `${weekStart}T12:00:00Z`).slice(0, 5);

/**
 * Audited catalogues per week over the last twelve weeks, as columns on one scale (the busiest week is
 * full height). The current week is the solid column; every column says its week, catalogues and rows
 * to screen readers and on hover, and the count is printed above it.
 */
export async function AuditsChart({ weeks }: { weeks: WeekCount[] }) {
  const { locale, ta } = await getI18n();
  const v = ta.firmX.value;
  const max = Math.max(...weeks.map((w) => w.catalogs), 0);
  const last = weeks.length - 1;
  return (
    <Card id="audits" title={v.weeksTitle} hint={v.weeksHint}>
      {max === 0 ? <p className="text-small text-muted">{v.weeksNone}</p> : (
        <>
          <ol aria-label={v.weeksTitle} className="relative flex h-36 items-end gap-1 border-b border-line pt-5">
            {weeks.map((w, i) => {
              const text = v.weekBar(dayMonth(locale, w.weekStart), fmtNumber(locale, w.catalogs), fmtNumber(locale, w.rows), w.catalogs);
              const pct = w.catalogs === 0 ? 0 : Math.max(4, (w.catalogs / max) * 100);
              return (
                <li key={w.weekStart} title={text} className="relative h-full min-w-0 flex-1">
                  <span className="sr-only">{text}</span>
                  {w.catalogs > 0 ? (
                    <>
                      <span
                        aria-hidden
                        className={cx('absolute bottom-0 left-1/2 block w-full max-w-6 -translate-x-1/2 rounded-t-sm', i === last ? 'bg-brand' : 'bg-brand/35')}
                        style={{ height: `${pct}%` }}
                      />
                      <span aria-hidden className="absolute inset-x-0 text-center text-micro font-medium tabular-nums text-muted" style={{ bottom: `calc(${pct}% + 2px)` }}>
                        {fmtNumber(locale, w.catalogs)}
                      </span>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div aria-hidden className="mt-1.5 flex justify-between text-micro tabular-nums text-muted">
            <span>{dayMonth(locale, weeks[0]?.weekStart ?? '')}</span>
            <span>{v.thisWeek}</span>
          </div>
        </>
      )}
    </Card>
  );
}

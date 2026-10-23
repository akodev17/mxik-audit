import { fmtDate } from '@tasnivo/i18n/format';
import { serverApi } from '@/lib/api/server';
import { bannerReasons } from '@/lib/catalogs/report';
import { getI18n } from '@/lib/locale';
import { cx } from '@/ui/cx';
import { IconAlert } from '@/ui/icons';

/**
 * Warns when the classifier copy is older than 7 days or the last update failed
 * (the classifier part of GET /api/health). Renders nothing otherwise.
 */
export async function ClassifierBanner({ className = '' }: { className?: string }) {
  const [{ classifier: state }, { ta, locale }] = await Promise.all([serverApi().health.get(), getI18n()]);
  const banner = bannerReasons(state);
  if (banner.length === 0 || !state.takenAt || state.ageDays === null) return null;
  const b = ta.wsX.classifierBanner;
  return (
    <section role="status" aria-label={b.title} className={cx('flex gap-2.5 rounded-md border border-warn/50 bg-warn-tint px-3.5 py-2.5 text-small text-warn-ink', className)}>
      <IconAlert size={16} className="mt-px shrink-0" />
      <div className="min-w-0">
        <p className="font-semibold">{b.title}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {banner.includes('stale') ? <li>{b.stale(state.ageDays, fmtDate(locale, state.takenAt))}</li> : null}
          {banner.includes('failed') && state.lastUpdate ? <li>{b.failed(fmtDate(locale, state.lastUpdate.at))}</li> : null}
        </ul>
        <p className="mt-1 text-micro">{b.hint}</p>
      </div>
    </section>
  );
}

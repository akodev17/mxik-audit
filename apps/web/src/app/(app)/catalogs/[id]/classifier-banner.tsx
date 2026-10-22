import { classifierState } from '@tasnivo/domain/classifier-state';
import { fmtDate } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { IconAlert } from '@/ui/icons';

/**
 * Warns when the classifier copy is older than 7 days or the last update failed
 * (rule: src/lib/classifier-freshness.ts). Renders nothing otherwise.
 */
export async function ClassifierBanner({ className = '' }: { className?: string }) {
  const [state, { ta, locale }] = await Promise.all([classifierState(), getI18n()]);
  if (state.banner.length === 0 || !state.takenAt || state.ageDays === null) return null;
  const b = ta.wsX.classifierBanner;
  return (
    <section role="status" aria-label={b.title} className={`rounded-ctl border border-line bg-warn-tint px-3 py-2 text-small text-warn-ink ${className}`}>
      <p className="flex items-center gap-1.5 font-medium"><IconAlert size={14} />{b.title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {state.banner.includes('stale') ? <li>{b.stale(state.ageDays, fmtDate(locale, state.takenAt))}</li> : null}
        {state.banner.includes('failed') && state.lastUpdate ? <li>{b.failed(fmtDate(locale, state.lastUpdate.at))}</li> : null}
      </ul>
      <p className="mt-1 text-micro">{b.hint}</p>
    </section>
  );
}

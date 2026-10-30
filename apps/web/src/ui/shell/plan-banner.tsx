'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/locale-client';
import { StatusIcon } from '../badge';
import { cx } from '../cx';
import { IconChevron } from '../icons';
import { bannerLines, joinSentences, type BannerLine } from './plan-banner-lines';
import type { ShellData } from './shell-queries';

/**
 * One quiet line under the header when the plan needs a look: expired or a full limit (danger), a limit
 * near 80% (warn), and a trial or subscription ending within a week added to either (bannerLines).
 * A status icon and the words carry the meaning; the strip itself stays on the page surface, so it
 * informs without competing with the page.
 */
export function PlanBanner({ plan }: { plan: ShellData['plan'] }) {
  const { ta } = useI18n();
  const banner = bannerLines(plan);
  if (!banner) return null;
  const names = (keys: ShellData['plan']['full']): string => keys.map((k) => ta.plan.keys[k]).join(', ');
  const phrase = (line: BannerLine): string => {
    switch (line.kind) {
      case 'expired': return ta.plan.expired;
      case 'full': return ta.plan.full(names(line.keys));
      case 'warn': return ta.plan.warn(names(line.keys));
      case 'trialEnds': return ta.plan.trial(line.days);
      case 'subscriptionEnds': return ta.setX.plan.endingSoon(line.days);
    }
  };
  const { tone } = banner;
  return (
    <div role="status" className="no-print flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2 text-small sm:px-6">
      <span aria-hidden className={cx('inline-flex shrink-0', tone === 'danger' ? 'text-danger-ink' : 'text-warn-ink')}><StatusIcon tone={tone} size={16} /></span>
      <span className="min-w-0 flex-1 text-fg">{joinSentences(banner.lines.map(phrase))}</span>
      <Link href="/settings?tab=plan" className="inline-flex shrink-0 items-center gap-0.5 font-medium text-brand-ink hover:underline">
        {ta.plan.upgrade}<IconChevron size={12} />
      </Link>
    </div>
  );
}

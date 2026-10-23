'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/locale-client';
import { StatusIcon } from '../badge';
import { cx } from '../cx';
import { IconChevron } from '../icons';
import type { ShellData } from './shell-queries';

/**
 * One quiet line under the header when the plan needs a look: expired or a full limit (danger), a limit
 * near 80% or a trial ending soon (warn). A status icon and the words carry the meaning; the strip itself
 * stays on the page surface, so it informs without competing with the page.
 */
export function PlanBanner({ plan }: { plan: ShellData['plan'] }) {
  const { ta } = useI18n();
  const names = (keys: ShellData['plan']['full']): string => keys.map((k) => ta.plan.keys[k]).join(', ');
  let text: string | null = null;
  let tone: 'warn' | 'danger' = 'warn';
  if (plan.state === 'expired') { text = ta.plan.expired; tone = 'danger'; }
  else if (plan.full.length > 0) { text = ta.plan.full(names(plan.full)); tone = 'danger'; }
  else if (plan.warnings.length > 0) text = ta.plan.warn(names(plan.warnings));
  else if (plan.state === 'trial' && plan.daysLeft !== null && plan.daysLeft <= 5) text = ta.plan.trial(plan.daysLeft);
  if (!text) return null;
  return (
    <div role="status" className="no-print flex items-center gap-2.5 border-b border-line bg-surface px-4 py-2 text-small sm:px-6">
      <span aria-hidden className={cx('inline-flex shrink-0', tone === 'danger' ? 'text-danger-ink' : 'text-warn-ink')}><StatusIcon tone={tone} size={16} /></span>
      <span className="min-w-0 flex-1 text-fg">{text}</span>
      <Link href="/settings?tab=plan" className="inline-flex shrink-0 items-center gap-0.5 font-medium text-brand-ink hover:underline">
        {ta.plan.upgrade}<IconChevron size={12} />
      </Link>
    </div>
  );
}

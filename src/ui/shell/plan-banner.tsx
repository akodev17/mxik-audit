'use client';

import { useI18n } from '@/lib/locale-client';
import Link from 'next/link';
import type { ShellData } from '@/lib/shell-data';

/** One slim line under the top bar: expired, a full limit, a limit near 80%, or a trial ending soon. */
export function PlanBanner({ plan }: { plan: ShellData['plan'] }) {
  const { ta } = useI18n();
  const names = (keys: ShellData['plan']['full']): string => keys.map((k) => ta.plan.keys[k]).join(', ');
  let text: string | null = null;
  let tone = 'bg-warn-tint text-warn-ink';
  if (plan.state === 'expired') { text = ta.plan.expired; tone = 'bg-danger-tint text-danger-ink'; }
  else if (plan.full.length > 0) { text = ta.plan.full(names(plan.full)); tone = 'bg-danger-tint text-danger-ink'; }
  else if (plan.warnings.length > 0) text = ta.plan.warn(names(plan.warnings));
  else if (plan.state === 'trial' && plan.daysLeft !== null && plan.daysLeft <= 5) text = ta.plan.trial(plan.daysLeft);
  if (!text) return null;
  return (
    <div role="status" className={`no-print flex items-center justify-between gap-3 px-4 py-1.5 text-sm ${tone}`}>
      <span>{text}</span>
      <Link href="/settings#plan" className="shrink-0 font-medium underline">{ta.plan.upgrade}</Link>
    </div>
  );
}

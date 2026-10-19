'use client';

import type { MatchStage } from '@/core/match/types';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { suggestionLabel } from '@/ui/labels';

type Props = { confidence: number | null; stage: MatchStage | null; show: boolean };

/** How well the suggestion matched, in words ("Yuqori moslik"), or where it came from. Never a percentage. */
export function MatchChip({ confidence, stage, show }: Props) {
  const { t, ta } = useI18n();
  const label = show ? suggestionLabel(t, ta, { confidence, stage }) : null;
  if (!label) return <span className="text-muted" aria-hidden>—</span>;
  return <StatusChip tone={label.tone} icon={<StatusIcon tone={label.tone} size={12} />}>{label.label}</StatusChip>;
}

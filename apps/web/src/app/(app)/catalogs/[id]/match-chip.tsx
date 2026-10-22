'use client';

import type { MatchStage } from '@tasnivo/core/match/types';
import { useI18n } from '@/lib/locale-client';
import { StatusChip, StatusIcon } from '@/ui/badge';
import { suggestionLabel } from '@/ui/labels';
import { CellChip } from './cell-chip';

/** `short`: the grid's narrow "Moslik" column, where the band name alone fits ("Yuqori"). */
type Props = { confidence: number | null; stage: MatchStage | null; show: boolean; short?: boolean };

/** How well the suggestion matched, in words ("Yuqori moslik"), or where it came from. Never a percentage. */
export function MatchChip({ confidence, stage, show, short = false }: Props) {
  const { t, ta } = useI18n();
  const label = show ? suggestionLabel(t, ta, { confidence, stage }) : null;
  if (!label) return <span className="text-muted" aria-hidden>—</span>;
  if (short) return <CellChip tone={label.tone} label={ta.wsX.match.short[label.key]} title={label.label} />;
  return <StatusChip tone={label.tone} icon={<StatusIcon tone={label.tone} size={12} />}>{label.label}</StatusChip>;
}

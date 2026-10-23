'use client';

import type { MATCH_STAGES } from '@tasnivo/contracts';
import { useI18n } from '@/lib/locale-client';
import type { LabelKey } from '@/lib/pure/confidence-labels';
import { cx } from '@/ui/cx';
import { suggestionLabel } from '@/ui/labels';

type MatchStage = (typeof MATCH_STAGES)[number];

/** Bars lit per band: an identity (barcode, dictionary) is as strong as the high band. */
const LIT: Record<LabelKey, number> = { barcode: 3, dictionary: 3, sure: 3, likely: 2, check: 1 };

type Props = {
  confidence: number | null;
  stage: MatchStage | null;
  show: boolean;
  /** Bars only (the label moves to the title), for a cell that also holds the code. */
  barsOnly?: boolean;
  className?: string;
};

/**
 * How well a suggestion matched, as three small bars and the band name ("Yuqori"). One neutral
 * brand scale: status colours belong to the problem column, and a low band is not an error.
 * The full label ("Yuqori moslik") is the title and the accessible text. Never a percentage.
 */
export function ConfidenceMeter({ confidence, stage, show, barsOnly = false, className }: Props) {
  const { t, ta } = useI18n();
  const label = show ? suggestionLabel(t, ta, { confidence, stage }) : null;
  if (!label) return barsOnly ? null : <span className="text-muted" aria-hidden>—</span>;
  const lit = LIT[label.key];
  return (
    <span className={cx('inline-flex min-w-0 max-w-full items-center gap-2', className)} title={label.label}>
      <span aria-hidden className="flex h-3.5 shrink-0 items-end gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx('w-1 rounded-full', i === 0 ? 'h-1.5' : i === 1 ? 'h-2.5' : 'h-3.5', i < lit ? 'bg-brand' : 'bg-line-strong')} />
        ))}
      </span>
      {barsOnly
        ? <span className="sr-only">{label.label}</span>
        : <span className="min-w-0 truncate text-small leading-4 text-fg"><span aria-hidden>{ta.wsX.match.short[label.key]}</span><span className="sr-only">{label.label}</span></span>}
    </span>
  );
}

// User-facing confidence labels. The number stays available as detail; the
// label is what an accountant reads. Pure, so the UI and exports agree.
import { BANDS } from './score.js';

export type ConfidenceLabel = 'sure' | 'likely' | 'check';

/** Label thresholds. `sure` equals the bulk-accept band so the two never disagree. */
export const CONFIDENCE_LABELS = {
  sure: BANDS.high,
  likely: 0.75,
} as const;

/** A barcode match is an identity, not a guess, so it is always "sure". */
export function confidenceLabel(confidence: number, opts: { barcode?: boolean } = {}): ConfidenceLabel {
  if (opts.barcode) return 'sure';
  if (confidence >= CONFIDENCE_LABELS.sure) return 'sure';
  if (confidence >= CONFIDENCE_LABELS.likely) return 'likely';
  return 'check';
}

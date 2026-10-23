// How a suggestion is labelled (core match/confidence-labels.ts): its source when that is an
// identity, else its score band. A match score ranks candidates; it is not a probability.
// tests/web-parity holds this to the original.
import { MATCH_STAGES } from '@tasnivo/contracts';
import { SURE_BAND_MIN } from '@tasnivo/contracts/modules/workspace';
import type { LabelKey } from './constants';

export type { LabelKey } from './constants';
export type MatchStage = (typeof MATCH_STAGES)[number];

/** Score band. Keys are stable (stored with feedback); `sure` reads "high match", never certainty. */
export type ConfidenceLabel = 'sure' | 'likely' | 'check';

/** Label thresholds. `sure` equals the bulk-accept band so the two never disagree. */
export const CONFIDENCE_LABELS = { sure: SURE_BAND_MIN, likely: 0.75 } as const;

/** The score band. A barcode match is an identity, not a guess, so it is always the top band. */
export function confidenceLabel(confidence: number, opts: { barcode?: boolean } = {}): ConfidenceLabel {
  if (opts.barcode) return 'sure';
  if (confidence >= CONFIDENCE_LABELS.sure) return 'sure';
  if (confidence >= CONFIDENCE_LABELS.likely) return 'likely';
  return 'check';
}

/** The label for a suggestion, from its score and the stage that produced it. Null when there is nothing to label. */
export function labelKey(confidence: number | null, stage?: MatchStage | null): LabelKey | null {
  if (stage === 'barcode') return 'barcode';
  if (stage === 'dictionary') return 'dictionary';
  return confidence === null ? null : confidenceLabel(confidence);
}

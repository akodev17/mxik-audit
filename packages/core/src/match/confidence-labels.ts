// User-facing confidence labels: the single place a suggestion's label is
// decided, so the UI, exports and feedback agree. A match score ranks
// candidates; it is not a probability, so the labels name how well a code
// matched, or where it came from when it is an identity. Pure.
import { readEvidence } from './evidence.js';
import { BANDS } from './score.js';
import type { MatchStage } from './types.js';

/** Score band. Keys are stable (stored with feedback); `sure` reads "high match", never certainty. */
export type ConfidenceLabel = 'sure' | 'likely' | 'check';

/** What a suggestion is labelled: its source when that is an identity, else its score band. */
export type LabelKey = 'barcode' | 'dictionary' | ConfidenceLabel;

/** Label thresholds. `sure` equals the bulk-accept band so the two never disagree. */
export const CONFIDENCE_LABELS = {
  sure: BANDS.high,
  likely: 0.75,
} as const;

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

/** The label for a stored finding: its confidence plus the stage in its evidence JSON. */
export function findingLabelKey(finding: { confidence: number | null; evidence: unknown }): LabelKey | null {
  return labelKey(finding.confidence, readEvidence(finding.evidence)?.stage ?? null);
}

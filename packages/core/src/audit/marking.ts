// Whether a row needs a marking code (markirovka). Pure.
import { labelKey } from '../match/confidence-labels.js';
import type { ScoredCandidate } from '../match/types.js';
import type { Finding } from './checks.js';

/**
 * Marking follows the classifier's own flag, on the row's code or on a code we
 * suggest. The row's own marked code always counts. A suggested code counts
 * only when the workspace would label it top tier: "Yuqori moslik" (labelKey
 * `sure`, the bulk-accept band) or an identity (barcode, firm dictionary). A
 * low or middling suggestion is a guess the reviewer may well reject, so its
 * flag must not put the row behind the Markirovka badge and filter.
 */
export function markingRequired(
  ownMarked: boolean, findings: readonly Finding[], suggestions: readonly ScoredCandidate[],
): boolean {
  if (ownMarked) return true;
  return findings.some((f) => {
    if (!f.suggestedMxik) return false;
    const key = labelKey(f.confidence, f.evidence?.stage ?? null);
    if (key !== 'sure' && key !== 'barcode' && key !== 'dictionary') return false;
    return suggestions.find((s) => s.candidate.code === f.suggestedMxik)?.candidate.isMarked === true;
  });
}

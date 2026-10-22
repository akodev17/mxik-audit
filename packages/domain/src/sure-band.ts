// The "accept all high-match suggestions" set, in one place: the button's count,
// its preview and the action itself select exactly the same findings.
import { Prisma } from '@prisma/client';
import { BANDS } from '@tasnivo/core/match/score';

/**
 * Pending code suggestions in the high band. Dictionary matches have their own
 * button and a reviewer-confirmed history, and a suggestion the AI review
 * rejected (rerankNone) is not a suggestion at all, so neither is included.
 * Expects `finding f`.
 */
export function sureBandSql(minConfidence: number = BANDS.high): Prisma.Sql {
  return Prisma.sql`f.decision = 'pending'::decision
    AND f.type IN ('MISSING'::finding_type, 'NOT_FOUND'::finding_type, 'MISMATCH'::finding_type)
    AND f."suggestedMxik" IS NOT NULL
    AND f.confidence >= ${minConfidence}
    AND coalesce(f.evidence->>'stage', '') <> 'dictionary'
    AND coalesce(f.evidence->>'rerankNone', 'false') <> 'true'`;
}

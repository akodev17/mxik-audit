// Decides whether a fused row is uncertain enough to spend an LLM call on. Pure.
// Skipping a row never lifts its cap: unreranked candidates stay below the
// bulk-accept band whatever this decides.
import type { RerankGate } from './rerank-config.js';

export type GateDecision = { rerank: boolean; reason: string };

/**
 * `scores` are retrieval confidences before the no-reranker cap, any order.
 * A missing gate means "rerank every fused row".
 */
export function rerankGate(scores: readonly number[], gate: RerankGate | undefined): GateDecision {
  if (scores.length === 0) return { rerank: false, reason: 'no candidates' };
  if (!gate) return { rerank: true, reason: 'no gate configured' };

  const sorted = [...scores].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const margin = top - (sorted[1] ?? 0);

  if (top < gate.minConfidence) {
    return { rerank: true, reason: `top-1 ${top.toFixed(2)} < ${gate.minConfidence}` };
  }
  if (margin < gate.minMargin) {
    return { rerank: true, reason: `margin ${margin.toFixed(2)} < ${gate.minMargin}` };
  }
  return { rerank: false, reason: `top-1 ${top.toFixed(2)}, margin ${margin.toFixed(2)}` };
}

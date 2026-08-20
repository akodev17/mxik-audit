// Confidence calibration. Pure. The formula and its justification live in
// docs/scoring.md; keep the two in step.
import type { ConfidenceBand, Signals } from './types.js';

export const BANDS = {
  /** Safe to bulk-accept; the UI pre-checks these. */
  high: 0.9,
  /** Needs a human eye; shown first, unchecked. */
  medium: 0.6,
} as const;

/** Signal weights. They sum to 1 across whichever signals are present. */
export const WEIGHTS = { lexical: 0.45, vector: 0.25, rrf: 0.30 } as const;

/** How much the reranker is allowed to move a retrieval-derived score. */
export const LLM_WEIGHT = 0.4;

/**
 * Ceiling applied when no reranker ran. Nothing reaches the "safe to
 * bulk-accept" band on retrieval signals alone — retrieval can tell us a row is
 * lexically close, not that it is the right classification.
 */
export const NO_RERANK_CEILING = 0.85;

/** Weight of the top-1/top-2 margin in the final score. */
const MARGIN_WEIGHT = 0.15;

export const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Cosine similarity in -1..1 mapped onto 0..1. */
export function cosineToUnit(cosine: number): number {
  return clamp01((cosine + 1) / 2);
}

/**
 * Blends the retrieval signals, renormalizing over whichever are present so a
 * missing stage does not silently drag the score toward zero.
 */
export function retrievalScore(signals: Signals): number {
  let weighted = 0;
  let total = 0;
  for (const key of ['lexical', 'vector', 'rrf'] as const) {
    const value = signals[key];
    if (value === undefined) continue;
    weighted += WEIGHTS[key] * clamp01(value);
    total += WEIGHTS[key];
  }
  return total === 0 ? 0 : weighted / total;
}

/** Folds the reranker's opinion into the retrieval score. */
export function blendWithLlm(retrieval: number, llm: number | undefined): number {
  if (llm === undefined) return retrieval;
  return (1 - LLM_WEIGHT) * retrieval + LLM_WEIGHT * clamp01(llm);
}

/**
 * How decisively the leader beats the runner-up, as a 0..1 fraction of the
 * leader's own score. A clear winner earns a small bonus; a photo finish does not.
 */
export function marginFactor(topScore: number, runnerUpScore: number | undefined): number {
  if (runnerUpScore === undefined) return 1;
  if (topScore <= 0) return 0;
  return clamp01((topScore - runnerUpScore) / topScore);
}

export type CalibrationInput = {
  signals: Signals;
  /** Blended score of the next-best candidate, for the margin bonus. */
  runnerUp?: number | undefined;
  /** False when the reranker did not run, which caps the result. */
  rerankAvailable: boolean;
  /** Additive rule adjustments, applied before clamping. */
  adjustment?: number;
};

/** The single place a confidence number is produced. */
export function calibrate(input: CalibrationInput): number {
  const retrieval = retrievalScore(input.signals);
  const blended = blendWithLlm(retrieval, input.signals.llm);
  const margin = marginFactor(blended, input.runnerUp);
  const shaped = blended * (1 - MARGIN_WEIGHT + MARGIN_WEIGHT * margin);
  const adjusted = shaped + (input.adjustment ?? 0);
  const capped = input.rerankAvailable ? adjusted : Math.min(adjusted, NO_RERANK_CEILING);
  return clamp01(capped);
}

export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= BANDS.high) return 'high';
  if (confidence >= BANDS.medium) return 'medium';
  return 'low';
}

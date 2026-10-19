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

/**
 * Half-saturation constant for full-text ranks. "searchVector" carries no
 * weights, so every lexeme has ts_rank_cd's default D weight of 0.1 and each
 * matched word occurrence adds 0.1: the score reads n/(n+1) for n matches.
 */
export const FULLTEXT_K = 0.1;

/** ts_rank_cd (unbounded) mapped onto 0..1 absolutely, not against the best hit of the query. */
export function fullTextToUnit(rank: number): number {
  return rank <= 0 ? 0 : rank / (rank + FULLTEXT_K);
}

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
  /** Margin factor (0..1) already known to the caller; wins over `runnerUp`. */
  margin?: number | undefined;
  /** False when the reranker did not run, which caps the result. */
  rerankAvailable: boolean;
  /** Additive rule adjustments, applied before clamping. */
  adjustment?: number;
};

/** The single place a confidence number is produced. */
export function calibrate(input: CalibrationInput): number {
  const retrieval = retrievalScore(input.signals);
  const blended = blendWithLlm(retrieval, input.signals.llm);
  const margin = input.margin === undefined ? marginFactor(blended, input.runnerUp) : clamp01(input.margin);
  const shaped = blended * (1 - MARGIN_WEIGHT + MARGIN_WEIGHT * margin);
  const adjusted = shaped + (input.adjustment ?? 0);
  const capped = input.rerankAvailable ? adjusted : Math.min(adjusted, NO_RERANK_CEILING);
  return clamp01(capped);
}

export type PoolInput = Omit<CalibrationInput, 'runnerUp' | 'margin'>;

/** A candidate's score with rules and the ceiling applied but no margin shaping; what a pool is ranked by. */
export function adjustedScore(input: PoolInput): number {
  return calibrate({ ...input, margin: 1 });
}

export type PoolScore = {
  /** Ranking score: rules and ceiling applied, no margin shaping. */
  adjusted: number;
  /** Final calibrated confidence. */
  confidence: number;
};

/**
 * Calibrates a candidate pool, returned in input order. The leader by adjusted
 * score is shaped with its real gap to #2; every other candidate is shaped as a
 * dead heat (margin 0), so a runner-up can never collect the bonus the leader
 * was denied for being in a close race.
 */
export function calibratePool(inputs: readonly PoolInput[]): PoolScore[] {
  const adjusted = inputs.map(adjustedScore);
  const order = adjusted.map((_, i) => i).sort((a, b) => (adjusted[b] ?? 0) - (adjusted[a] ?? 0) || a - b);
  const leader = order[0];
  const second = order[1];
  const leaderMargin = leader === undefined
    ? 0
    : marginFactor(adjusted[leader] ?? 0, second === undefined ? undefined : adjusted[second]);
  return inputs.map((input, i) => ({
    adjusted: adjusted[i] ?? 0,
    confidence: calibrate({ ...input, margin: i === leader ? leaderMargin : 0 }),
  }));
}

export function bandOf(confidence: number): ConfidenceBand {
  if (confidence >= BANDS.high) return 'high';
  if (confidence >= BANDS.medium) return 'medium';
  return 'low';
}

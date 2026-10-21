// Aggregates per-case outcomes into the numbers the eval reports. Pure.
import type { CaseSource } from './cases.js';

export type Outcome = {
  id: string;
  source: CaseSource;
  name: string;
  correct: string[];
  predicted: string | null;
  confidence: number;
  band: 'high' | 'medium' | 'low' | 'none';
  /** 1-based rank of the first defensible code in the top 5, or null. */
  rank: number | null;
  /** A defensible code reached the pool handed to the reranker. */
  inPool: boolean;
  decidedBy: string;
  /** The gate passed this row to the reranker (or would have, in a dry run). */
  sentToLlm: boolean;
  ms: number;
};

export type GroupMetrics = {
  n: number;
  top1: number;
  top5: number;
  top1Pct: number;
  top5Pct: number;
  /** Rows landing in the bulk-accept band. */
  highCount: number;
  /** Share of rows in the high band. */
  highCoveragePct: number;
  /** Top-1 accuracy within the high band; null when the band is empty. */
  highPrecisionPct: number | null;
  meanConfidenceRight: number;
  meanConfidenceWrong: number;
  /** Share of rows whose correct code reached the rerank pool. */
  ceilingPct: number;
  /** Share of rows the gate sends to the LLM. */
  llmSharePct: number;
};

const pct = (part: number, whole: number): number => (whole === 0 ? 0 : (part / whole) * 100);
const mean = (xs: readonly number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export function summarize(outcomes: readonly Outcome[]): GroupMetrics {
  const n = outcomes.length;
  const right = outcomes.filter((o) => o.rank === 1);
  const wrong = outcomes.filter((o) => o.rank !== 1);
  const high = outcomes.filter((o) => o.band === 'high');
  const highRight = high.filter((o) => o.rank === 1).length;
  return {
    n,
    top1: right.length,
    top5: outcomes.filter((o) => o.rank !== null).length,
    top1Pct: pct(right.length, n),
    top5Pct: pct(outcomes.filter((o) => o.rank !== null).length, n),
    highCount: high.length,
    highCoveragePct: pct(high.length, n),
    highPrecisionPct: high.length === 0 ? null : pct(highRight, high.length),
    meanConfidenceRight: mean(right.map((o) => o.confidence)),
    meanConfidenceWrong: mean(wrong.map((o) => o.confidence)),
    ceilingPct: pct(outcomes.filter((o) => o.inPool).length, n),
    llmSharePct: pct(outcomes.filter((o) => o.sentToLlm).length, n),
  };
}

/** Metrics per source plus all rows together. */
export function bySource(outcomes: readonly Outcome[]): Record<'real' | 'synthetic' | 'all', GroupMetrics> {
  return {
    real: summarize(outcomes.filter((o) => o.source === 'real')),
    synthetic: summarize(outcomes.filter((o) => o.source === 'synthetic')),
    all: summarize(outcomes),
  };
}

/** The case set an outcome came from: the file label in its id ("real-metal.csv:12"). */
export const setOf = (id: string): string => id.slice(0, id.lastIndexOf(':')).replace(/\.csv$/, '');

/** Metrics per case set, so one customer file can be tracked on its own. */
export function bySet(outcomes: readonly Outcome[]): Record<string, GroupMetrics> {
  const sets = new Map<string, Outcome[]>();
  for (const o of outcomes) sets.set(setOf(o.id), [...(sets.get(setOf(o.id)) ?? []), o]);
  return Object.fromEntries([...sets].map(([set, list]) => [set, summarize(list)]));
}

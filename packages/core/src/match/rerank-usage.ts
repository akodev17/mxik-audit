// Turns per-run LLM accounting into the numbers an operator asks about. Pure.
import type { RerankUsage } from './types.js';

/** Estimated USD per 1,000 catalogue rows, all rows counted, not just those sent. */
export function costPer1000Rows(usage: RerankUsage, totalRows: number): number | null {
  if (usage.estimatedCostUsd === null || totalRows === 0) return null;
  return (usage.estimatedCostUsd / totalRows) * 1000;
}

export function formatLlmUsage(usage: RerankUsage, totalRows: number): string {
  const per1000 = costPer1000Rows(usage, totalRows);
  return [
    `llm (${usage.model}): ${usage.rowsRequested} rows to rerank of ${totalRows}`,
    `  sent ${usage.rowsSent} in ${usage.apiCalls} calls, cache hits ${usage.cacheHits}, fell back ${usage.rowsFailed}, codes discarded ${usage.codesDiscarded}`,
    `  tokens in ${usage.inputTokens.toLocaleString()} / out ${usage.outputTokens.toLocaleString()}, api time ${(usage.latencyMs / 1000).toFixed(1)}s${usage.batchLatencyP50Ms == null ? '' : `, p50 per call ${(usage.batchLatencyP50Ms / 1000).toFixed(1)}s`}`,
    `  est. cost $${usage.estimatedCostUsd?.toFixed(4) ?? '?'}${per1000 === null ? '' : `, ~$${per1000.toFixed(2)} per 1,000 catalogue rows`}`,
  ].join('\n');
}

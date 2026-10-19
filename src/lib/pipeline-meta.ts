// How an audit's matching pipeline ran, stored on Catalog.pipelineMeta so the
// workspace can say plainly when a run was degraded. Stable codes, not text:
// the UI translates them (ta.matchX.degraded). Pure.
import { z } from 'zod';
import type { RerankOutcome, VectorOutcome } from '../core/match/types.js';
import type { AppDict } from './i18n-app.js';

export const DEGRADED_REASONS = ['rerank_off', 'vector_off', 'vector_not_semantic', 'rerank_failed', 'vector_failed'] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

export type PipelineMeta = {
  /** Query-time embedding provider name. */
  embedder: string;
  /** False when stage 4 was switched off for the run (no or mismatched stored vectors). */
  vectorUsable: boolean;
  reranker: { enabled: boolean; model: string | null; promptVersion: string };
  degradedReasons: DegradedReason[];
  /** Rows matched by retrieval whose suggestion got no AI review: reranker off, skipped by the gate, or failed. */
  rowsWithoutAi: number;
  /** Rows whose AI call failed or returned nothing usable. */
  llmRowsFailed: number;
  /** Rows whose vector stage threw. */
  vectorErrors: number;
  /** Rows matched in this run; a resumed run counts only its own rows. */
  rowsAudited: number;
  /** First row of this run, above 0 for a resumed audit. */
  fromRow: number;
  finishedAt: string;
};

export type PipelineSetup = {
  embedder: { name: string; semantic: boolean };
  vectorUsable: boolean;
  reranker: { enabled: boolean; model: string | null; promptVersion: string };
};

export type PipelineCounters = { rowsAudited: number; rowsWithoutAi: number; llmRowsFailed: number; vectorErrors: number };

export const emptyCounters = (): PipelineCounters => ({ rowsAudited: 0, rowsWithoutAi: 0, llmRowsFailed: 0, vectorErrors: 0 });

const WITHOUT_AI = new Set<RerankOutcome>(['off', 'skipped', 'failed']);

/** Adds one matched row to the run's counters. */
export function countMatch(counters: PipelineCounters, match: { rerank: RerankOutcome; vector: VectorOutcome }): void {
  counters.rowsAudited++;
  if (WITHOUT_AI.has(match.rerank)) counters.rowsWithoutAi++;
  if (match.rerank === 'failed') counters.llmRowsFailed++;
  if (match.vector === 'failed') counters.vectorErrors++;
}

/** Degradations known before any row runs, from the provider setup alone. */
export function setupReasons(setup: PipelineSetup): DegradedReason[] {
  const reasons: DegradedReason[] = [];
  if (!setup.reranker.enabled) reasons.push('rerank_off');
  if (!setup.vectorUsable) reasons.push('vector_off');
  else if (!setup.embedder.semantic) reasons.push('vector_not_semantic');
  return reasons;
}

export function buildPipelineMeta(setup: PipelineSetup, counters: PipelineCounters, fromRow: number, finishedAt: Date): PipelineMeta {
  const reasons = setupReasons(setup);
  if (counters.llmRowsFailed > 0) reasons.push('rerank_failed');
  if (counters.vectorErrors > 0) reasons.push('vector_failed');
  return {
    embedder: setup.embedder.name,
    vectorUsable: setup.vectorUsable,
    reranker: setup.reranker,
    degradedReasons: reasons,
    ...counters,
    fromRow,
    finishedAt: finishedAt.toISOString(),
  };
}

const count = z.number().int().min(0).catch(0);
const Stored = z.object({
  embedder: z.string(),
  vectorUsable: z.boolean(),
  reranker: z.object({ enabled: z.boolean(), model: z.string().nullable().catch(null), promptVersion: z.string().catch('') }),
  degradedReasons: z.array(z.string()).catch([]),
  rowsWithoutAi: count,
  llmRowsFailed: count,
  vectorErrors: count,
  rowsAudited: count,
  fromRow: count,
  finishedAt: z.string().catch(''),
});

const KNOWN = new Set<string>(DEGRADED_REASONS);

/** Reads Catalog.pipelineMeta; null when absent (audits before it existed) or malformed. Unknown codes are dropped. */
export function readPipelineMeta(json: unknown): PipelineMeta | null {
  const parsed = Stored.safeParse(json);
  if (!parsed.success) return null;
  const degradedReasons = parsed.data.degradedReasons.filter((r): r is DegradedReason => KNOWN.has(r));
  return { ...parsed.data, degradedReasons };
}

/** One neutral sentence per degraded reason, in the viewer's language. Empty for a full run. */
export function degradedNotes(meta: PipelineMeta, ta: AppDict): string[] {
  const d = ta.matchX.degraded;
  return meta.degradedReasons.map((code) => {
    if (code === 'rerank_failed') return d.rerank_failed(meta.llmRowsFailed);
    if (code === 'vector_failed') return d.vector_failed(meta.vectorErrors);
    return d[code];
  });
}

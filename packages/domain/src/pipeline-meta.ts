// How an audit's matching pipeline ran, stored on Catalog.pipelineMeta so the
// workspace can say plainly when a run was degraded. Stable codes, not text:
// the UI translates them (ta.matchX.degraded). Pure.
import { z } from 'zod';
import type { RerankOutcome, VectorOutcome } from '@tasnivo/core/match/types';
import type { AppDict } from '@tasnivo/i18n/i18n-app';

export const DEGRADED_REASONS = [
  'rerank_off', 'vector_off', 'vector_not_semantic', 'rerank_failed', 'vector_failed', 'restricted_unchecked', 'rows_failed',
] as const;
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
  /** Rows matched, across every run of the audit (a resumed run adds to the counts stored before it). */
  rowsAudited: number;
  /** Rows still failing after their retries (CatalogItem.checkError set): not checked, never "ok". */
  rowsFailed: number;
  /** First row of the last run, above 0 for a resumed audit or a re-check. */
  fromRow: number;
  /** The counters cover every row below this index; a resume merges them only when it starts there. Null before 2026-10-29. */
  throughRow: number | null;
  finishedAt: string;
  /** catalog_snapshot id the run matched against; null when unknown (audits before 2026-10-21). */
  classifierSnapshotId: number | null;
  /** When that snapshot was taken (ISO); null when unknown. */
  classifierTakenAt: string | null;
};

/** The classifier snapshot an audit or eval ran against. */
export type ClassifierProvenance = { snapshotId: number | null; takenAt: string | null };

export type PipelineSetup = {
  embedder: { name: string; semantic: boolean };
  vectorUsable: boolean;
  reranker: { enabled: boolean; model: string | null; promptVersion: string };
  /** Absent when the caller does not know the snapshot; stored as nulls. */
  classifier?: ClassifierProvenance | undefined;
  /** Restricted codes loaded for the run: 0 when the table is empty or could not be read; absent when unknown. */
  restrictedCodes?: number | undefined;
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

/** Counters of two stretches of one audit, added. */
export function addCounters(a: PipelineCounters, b: PipelineCounters): PipelineCounters {
  return {
    rowsAudited: a.rowsAudited + b.rowsAudited,
    rowsWithoutAi: a.rowsWithoutAi + b.rowsWithoutAi,
    llmRowsFailed: a.llmRowsFailed + b.llmRowsFailed,
    vectorErrors: a.vectorErrors + b.vectorErrors,
  };
}

/**
 * The counters a run starts from: the stored ones when they cover exactly the rows below `fromRow`
 * (the heartbeat writes them together with the watermark), else none.
 */
export function resumeCounters(stored: PipelineMeta | null, fromRow: number): PipelineCounters {
  if (fromRow === 0 || !stored || stored.throughRow !== fromRow) return emptyCounters();
  const { rowsAudited, rowsWithoutAi, llmRowsFailed, vectorErrors } = stored;
  return { rowsAudited, rowsWithoutAi, llmRowsFailed, vectorErrors };
}

/** Degradations known before any row runs, from the provider setup alone. */
export function setupReasons(setup: PipelineSetup): DegradedReason[] {
  const reasons: DegradedReason[] = [];
  if (!setup.reranker.enabled) reasons.push('rerank_off');
  if (!setup.vectorUsable) reasons.push('vector_off');
  else if (!setup.embedder.semantic) reasons.push('vector_not_semantic');
  if (setup.restrictedCodes === 0) reasons.push('restricted_unchecked');
  return reasons;
}

/** What the counters cover: rows still failing, and the index below which every row is counted. */
export type RunExtent = { rowsFailed?: number; throughRow?: number | null };

export function buildPipelineMeta(
  setup: PipelineSetup, counters: PipelineCounters, fromRow: number, finishedAt: Date, extent: RunExtent = {},
): PipelineMeta {
  const reasons = setupReasons(setup);
  const rowsFailed = extent.rowsFailed ?? 0;
  if (counters.llmRowsFailed > 0) reasons.push('rerank_failed');
  if (counters.vectorErrors > 0) reasons.push('vector_failed');
  if (rowsFailed > 0) reasons.push('rows_failed');
  return {
    embedder: setup.embedder.name,
    vectorUsable: setup.vectorUsable,
    reranker: setup.reranker,
    degradedReasons: reasons,
    ...counters,
    rowsFailed,
    fromRow,
    throughRow: extent.throughRow ?? null,
    finishedAt: finishedAt.toISOString(),
    classifierSnapshotId: setup.classifier?.snapshotId ?? null,
    classifierTakenAt: setup.classifier?.takenAt ?? null,
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
  rowsFailed: count,
  fromRow: count,
  throughRow: z.number().int().min(0).nullable().catch(null),
  finishedAt: z.string().catch(''),
  classifierSnapshotId: z.number().int().nullable().catch(null),
  classifierTakenAt: z.string().nullable().catch(null),
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
    if (code === 'rows_failed') return d.rows_failed(meta.rowsFailed);
    return d[code];
  });
}

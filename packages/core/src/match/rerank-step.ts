// Stage 6 for one row: gate, call, validation. Never throws; a failure is an
// outcome the caller reports, and the row keeps the capped non-LLM ranking.
import type { RerankGate } from './rerank-config.js';
import { rerankGate } from './rerank-gate.js';
import { NONE_REASON } from './rerank-parse.js';
import type { CandidateStore, RerankOutcome, RerankProvider, RerankRequest, RerankVerdict } from './types.js';

export type LlmScore = { confidence: number; reason: string };

export type RerankStep = {
  /** Validated verdicts by code; empty unless the outcome is `ranked` or `none`. */
  scores: Map<string, LlmScore>;
  outcome: Exclude<RerankOutcome, 'not_needed'>;
  notes: string[];
};

export type RerankStepInput = {
  reranker: RerankProvider;
  store: CandidateStore;
  request: RerankRequest;
  /** Uncapped retrieval confidence per candidate, for the gate. */
  gateScores: readonly number[];
  gate?: RerankGate | undefined;
  /** Wraps the provider call, e.g. to time it. */
  run?: <T>(fn: () => Promise<T>) => Promise<T>;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function rerankStep(input: RerankStepInput): Promise<RerankStep> {
  const scores = new Map<string, LlmScore>();
  if (!input.reranker.available) return { scores, outcome: 'off', notes: [] };

  // The gate reads uncapped retrieval confidence; skipping never lifts the cap.
  const decision = rerankGate(input.gateScores, input.gate);
  if (!decision.rerank) return { scores, outcome: 'skipped', notes: [`Reranker skipped (${decision.reason}); confidence is capped.`] };

  const run = input.run ?? (<T>(fn: () => Promise<T>) => fn());
  let verdicts: RerankVerdict[];
  try {
    verdicts = await run(() => input.reranker.rerank(input.request));
  } catch (error) {
    return { scores, outcome: 'failed', notes: [`Reranker failed (${message(error)}); falling back to fusion order.`] };
  }

  const notes: string[] = [];
  const valid = await keepKnownCodes(verdicts, input.request.candidates.map((c) => c.code), input.store);
  if (valid.length < verdicts.length) {
    notes.push(`Reranker returned ${verdicts.length - valid.length} code(s) outside the candidates or the classifier; discarded.`);
  }
  if (valid.length === 0) return { scores, outcome: 'failed', notes: [...notes, 'Reranker gave no usable verdict; falling back to fusion order.'] };

  for (const v of valid) scores.set(v.code, { confidence: v.confidence, reason: v.reason });
  const none = valid.every((v) => v.confidence === 0 && v.reason === NONE_REASON);
  if (none) notes.push('Reranker judged that no candidate fits; no code is suggested.');
  return { scores, outcome: none ? 'none' : 'ranked', notes };
}

/** Drops any verdict whose code was not offered or is not a live classifier code. */
async function keepKnownCodes(
  verdicts: readonly RerankVerdict[],
  offered: readonly string[],
  store: CandidateStore,
): Promise<RerankVerdict[]> {
  const allowed = new Set(offered);
  const inPool = verdicts.filter((v) => allowed.has(v.code));
  if (inPool.length === 0) return [];
  const live = await store.liveCodes(inPool.map((v) => v.code));
  return inPool.filter((v) => live.has(v.code));
}

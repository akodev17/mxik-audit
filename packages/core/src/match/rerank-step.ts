// Stage 6 for one row: gate, call, validation. Never throws; a failure is an
// outcome the caller reports, and the row keeps the capped non-LLM ranking.
import type { RerankGate } from './rerank-config.js';
import { rerankGate } from './rerank-gate.js';
import { NONE_REASON } from './rerank-parse.js';
import type { CandidateStore, RerankOutcome, RerankProvider, RerankRequest, RerankVerdict } from './types.js';

export type LlmScore = { confidence: number; reason: string };

export type RerankStep = {
  /** Validated verdicts by code; empty unless the outcome is `ranked`. */
  scores: Map<string, LlmScore>;
  outcome: Exclude<RerankOutcome, 'not_needed'>;
  notes: string[];
  /**
   * LLM score for the candidates it left out of its ranking: 0 when it ranked
   * the row and its top pick clears OVERRIDE_CONFIDENCE (its order then wins),
   * else undefined (an unsure reranker does not push retrieval's picks down).
   */
  unranked: number | undefined;
};

/**
 * The reranker's own top confidence from which its ranking overrides retrieval
 * order. Measured 2026-10-28 (docs/scoring.md, "Reranker on (Gemini)"): with
 * gemini-3.1-flash-lite 0.5 and 0 tie and 0.7 loses 49 real-metal top-1 hits;
 * never overriding (old behaviour) loses 9 construction top-1 hits.
 */
export const OVERRIDE_CONFIDENCE = 0.5;

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
  if (!input.reranker.available) return { scores, outcome: 'off', notes: [], unranked: undefined };

  // The gate reads uncapped retrieval confidence; skipping never lifts the cap.
  const decision = rerankGate(input.gateScores, input.gate);
  if (!decision.rerank) return { scores, outcome: 'skipped', notes: [`Reranker skipped (${decision.reason}); confidence is capped.`], unranked: undefined };

  const run = input.run ?? (<T>(fn: () => Promise<T>) => fn());
  let verdicts: RerankVerdict[];
  try {
    verdicts = await run(() => input.reranker.rerank(input.request));
  } catch (error) {
    return { scores, outcome: 'failed', notes: [`Reranker failed (${message(error)}); falling back to fusion order.`], unranked: undefined };
  }

  const notes: string[] = [];
  const valid = await keepKnownCodes(verdicts, input.request.candidates.map((c) => c.code), input.store);
  if (valid.length < verdicts.length) {
    notes.push(`Reranker returned ${verdicts.length - valid.length} code(s) outside the candidates or the classifier; discarded.`);
  }
  if (valid.length === 0) return { scores, outcome: 'failed', notes: [...notes, 'Reranker gave no usable verdict; falling back to fusion order.'], unranked: undefined };

  const none = valid.every((v) => v.confidence === 0 && v.reason === NONE_REASON);
  // A "none" is a fallback, not a veto (2026-10-28, docs/scoring.md): it was wrong
  // 43 times in 46 on the eval sets. No candidate is scored, so all stay in
  // retrieval order under the no-reranker cap, and the outcome still says 'none'.
  if (none) return { scores, outcome: 'none', notes: [...notes, 'Reranker judged that no candidate fits; retrieval order kept, capped.'], unranked: undefined };
  for (const v of valid) scores.set(v.code, { confidence: v.confidence, reason: v.reason });
  const top = Math.max(...valid.map((v) => v.confidence));
  return { scores, outcome: 'ranked', notes, unranked: top >= OVERRIDE_CONFIDENCE ? 0 : undefined };
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

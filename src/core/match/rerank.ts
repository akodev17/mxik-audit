// Stage 6 entry point: picks the reranker from the environment. The pieces live
// in rerank-*.ts — config, gate, prompt, strict parsing, cache, batching and
// the Claude client.
import { BatchedReranker } from './rerank-batched.js';
import type { RerankCache } from './rerank-cache.js';
import { ClaudeRerankClient } from './rerank-claude.js';
import { rerankConfigFromEnv, type EnvLike, type RerankGate } from './rerank-config.js';
import type { RerankProvider, RerankVerdict } from './types.js';

/** Used when no key is configured or LLM calls are switched off: fusion order stands. */
export class NoopRerankProvider implements RerankProvider {
  readonly name: string;
  readonly available = false;
  constructor(reason = 'no ANTHROPIC_API_KEY') {
    this.name = `noop (${reason})`;
  }
  rerank(): Promise<RerankVerdict[]> {
    return Promise.resolve([]);
  }
}

export type RerankSetup = {
  reranker: RerankProvider;
  /** Which fused rows are uncertain enough to send. */
  gate: RerankGate;
};

/**
 * Builds a fresh reranker, so usage accounting covers exactly one run. Pass a
 * cache to reuse verdicts across runs.
 */
export function rerankFromEnv(env: EnvLike = process.env, cache?: RerankCache): RerankSetup {
  const config = rerankConfigFromEnv(env);
  if (!config.enabled) {
    return { reranker: new NoopRerankProvider(config.disabledReason ?? undefined), gate: config.gate };
  }
  return {
    reranker: new BatchedReranker(new ClaudeRerankClient(config), { ...config, cache }),
    gate: config.gate,
  };
}

/** Back-compatible shorthand for callers that only need the provider. */
export function rerankProviderFromEnv(env: EnvLike = process.env): RerankProvider {
  return rerankFromEnv(env).reranker;
}

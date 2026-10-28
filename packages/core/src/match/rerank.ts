// Stage 6 entry point: picks the reranker from the environment. The pieces live
// in rerank-*.ts — config, gate, prompt, strict parsing, cache, batching and
// the Claude and Gemini clients.
import { BatchedReranker } from './rerank-batched.js';
import type { RerankCache } from './rerank-cache.js';
import { ClaudeRerankClient, type RerankClient } from './rerank-claude.js';
import { rerankConfigFromEnv, type EnvLike, type RerankConfig, type RerankGate } from './rerank-config.js';
import { GeminiRerankClient } from './rerank-gemini.js';
import type { RerankProvider, RerankVerdict } from './types.js';

/** Used when no key is configured or LLM calls are switched off: fusion order stands. */
export class NoopRerankProvider implements RerankProvider {
  readonly name: string;
  readonly available = false;
  constructor(reason = 'no reranker key') {
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

/** The client for the configured provider (RERANK_PROVIDER, else whichever key is set). */
export function rerankClientFor(config: RerankConfig): RerankClient {
  return config.provider === 'gemini' ? new GeminiRerankClient(config) : new ClaudeRerankClient(config);
}

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
    reranker: new BatchedReranker(rerankClientFor(config), { ...config, cache }),
    gate: config.gate,
  };
}

/** Back-compatible shorthand for callers that only need the provider. */
export function rerankProviderFromEnv(env: EnvLike = process.env): RerankProvider {
  return rerankFromEnv(env).reranker;
}

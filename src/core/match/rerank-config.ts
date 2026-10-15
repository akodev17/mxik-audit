// Reranker configuration, read once from the environment. Pure: takes an env
// object so tests never depend on the real process environment.
export type EnvLike = Record<string, string | undefined>;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** When a fused row is uncertain enough to be worth an LLM call. */
export type RerankGate = {
  /** Rerank when the top-1 retrieval confidence (before the cap) is below this. */
  minConfidence: number;
  /** Rerank when top-1 minus top-2 retrieval confidence is below this. */
  minMargin: number;
};

export type RerankConfig = {
  /** False when there is no key, or MXIK_LLM_ENABLED=false. */
  enabled: boolean;
  /** Why the reranker is off, for operator-facing notes. */
  disabledReason: string | null;
  apiKey: string | null;
  model: string;
  baseUrl: string;
  /** Omitted from the request when null (older models reject the field). */
  effort: Effort | null;
  /** Server-side refusal fallback; only for models that support it. */
  fallbacks: boolean;
  gate: RerankGate;
  batchSize: number;
  batchWaitMs: number;
  timeoutMs: number;
  maxRetries: number;
  /** USD per million tokens, for the cost estimate only. Null when unknown. */
  price: { inputPerMTok: number; outputPerMTok: number } | null;
};

// Current IDs and first-party prices from https://platform.claude.com/docs/en/models/overview
// (checked 2026-10-15). Default is the model that page recommends starting with.
export const DEFAULT_MODEL = 'claude-opus-5-5';

const PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 },
};

/** Models that accept `fallbacks: "default"`. Haiku 5.5 has no server-side fallback. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-fable-5']);

const EFFORTS = new Set<Effort>(['low', 'medium', 'high', 'xhigh', 'max']);

/** Conservative defaults: anything short of a clear, confident winner goes to the LLM. */
export const DEFAULT_GATE: RerankGate = { minConfidence: 0.95, minMargin: 0.1 };

function num(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function priceFor(model: string, env: EnvLike): RerankConfig['price'] {
  const input = Number(env['RERANK_PRICE_INPUT_PER_MTOK']);
  const output = Number(env['RERANK_PRICE_OUTPUT_PER_MTOK']);
  if (Number.isFinite(input) && input > 0 && Number.isFinite(output) && output > 0) {
    return { inputPerMTok: input, outputPerMTok: output };
  }
  return PRICES[model] ?? null;
}

export function rerankConfigFromEnv(env: EnvLike): RerankConfig {
  const apiKey = env['ANTHROPIC_API_KEY']?.trim() || null;
  const model = env['ANTHROPIC_MODEL']?.trim() || DEFAULT_MODEL;
  const switchedOff = env['MXIK_LLM_ENABLED']?.trim().toLowerCase() === 'false';
  // Deliberately NOT ANTHROPIC_BASE_URL: agent tooling sets that variable for its
  // own routing, and inheriting it would send the caller's key somewhere else.
  const override = env['MXIK_ANTHROPIC_BASE_URL']?.trim();
  const baseUrl = override && /^https?:\/\//.test(override) ? override : 'https://api.anthropic.com';

  const rawEffort = env['ANTHROPIC_EFFORT']?.trim().toLowerCase();
  const effort: Effort | null = rawEffort === undefined
    ? 'low'
    : EFFORTS.has(rawEffort as Effort) ? (rawEffort as Effort) : null;

  const disabledReason = switchedOff
    ? 'MXIK_LLM_ENABLED=false'
    : apiKey === null ? 'no ANTHROPIC_API_KEY' : null;

  return {
    enabled: disabledReason === null,
    disabledReason,
    apiKey,
    model,
    baseUrl,
    effort,
    fallbacks: env['ANTHROPIC_FALLBACKS']?.trim().toLowerCase() !== 'off' && FALLBACK_MODELS.has(model),
    gate: {
      minConfidence: num(env['RERANK_GATE_CONFIDENCE'], DEFAULT_GATE.minConfidence, 0, 1.01),
      minMargin: num(env['RERANK_GATE_MARGIN'], DEFAULT_GATE.minMargin, 0, 1),
    },
    batchSize: Math.round(num(env['RERANK_BATCH_SIZE'], 8, 1, 25)),
    batchWaitMs: Math.round(num(env['RERANK_BATCH_WAIT_MS'], 30, 0, 2000)),
    timeoutMs: Math.round(num(env['RERANK_TIMEOUT_MS'], 60_000, 1000, 600_000)),
    maxRetries: Math.round(num(env['RERANK_MAX_RETRIES'], 2, 0, 5)),
    price: priceFor(model, env),
  };
}

// Reranker configuration, read once from the environment. Pure: takes an env
// object so tests never depend on the real process environment.
export type EnvLike = Record<string, string | undefined>;

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';
const THINKING_LEVELS = new Set<ThinkingLevel>(['minimal', 'low', 'medium', 'high']);

/** Which API answers stage 6. Chosen by RERANK_PROVIDER, else by which key is set. */
export type RerankProviderName = 'gemini' | 'anthropic';

/** When a fused row is uncertain enough to be worth an LLM call. */
export type RerankGate = {
  /** Rerank when the top-1 retrieval confidence (before the cap) is below this. */
  minConfidence: number;
  /** Rerank when top-1 minus top-2 retrieval confidence is below this. */
  minMargin: number;
};

export type RerankConfig = {
  /** False when the provider's key is missing, RERANK_PROVIDER=off, or MXIK_LLM_ENABLED=false. */
  enabled: boolean;
  /** Why the reranker is off, for operator-facing notes. */
  disabledReason: string | null;
  /** The provider that answers (or would answer, once its key is set). */
  provider: RerankProviderName;
  /** "provider:model", as stored on Catalog.pipelineMeta and shown to operators. */
  name: string;
  apiKey: string | null;
  model: string;
  baseUrl: string;
  /** Anthropic only. Omitted from the request when null (older models reject the field). */
  effort: Effort | null;
  /** Anthropic only. Server-side refusal fallback; only for models that support it. */
  fallbacks: boolean;
  /** Gemini 2.5 only. Thinking-token budget; null leaves the model's own default. */
  thinkingBudget: number | null;
  /** Gemini 3 only. Thinking level; wins over the budget when both are set. Null leaves the model's default. */
  thinkingLevel: ThinkingLevel | null;
  gate: RerankGate;
  batchSize: number;
  batchWaitMs: number;
  timeoutMs: number;
  maxRetries: number;
  /** USD per million tokens, for the cost estimate only. Null when unknown. */
  price: { inputPerMTok: number; outputPerMTok: number } | null;
};

// Current IDs and first-party prices from https://platform.claude.com/docs/en/models/overview
// (re-checked 2026-10-16 against the claude-api reference cached 2026-10-06).
// Default is the model that page recommends starting with.
export const DEFAULT_MODEL = 'claude-opus-5-5';

/** Fast, cheap and on the free tier; the reranker was measured with it (docs/scoring.md). */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20 },
  'claude-opus-5': { inputPerMTok: 5, outputPerMTok: 25 },
  'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 },
  'claude-haiku-5-5': { inputPerMTok: 0.1, outputPerMTok: 0.5 },
  'claude-fable-5-1': { inputPerMTok: 10, outputPerMTok: 50 },
  // Paid-tier standard text prices from https://ai.google.dev/gemini-api/docs/pricing
  // (page dated 2026-10-27, checked 2026-10-28). Thinking tokens bill as output.
  // The free tier costs nothing but is rate-limited; these are what a paid key pays.
  'gemini-2.5-flash': { inputPerMTok: 0.3, outputPerMTok: 2.5 },
  'gemini-2.5-pro': { inputPerMTok: 1.25, outputPerMTok: 10 },
  'gemini-2.5-flash-lite': { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  'gemini-3-flash-preview': { inputPerMTok: 0.5, outputPerMTok: 3 },
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

/** A pair of positive prices from two variables, or null when either is missing or invalid. */
function pricePair(env: EnvLike, inputVar: string, outputVar: string): RerankConfig['price'] {
  const input = Number(env[inputVar]);
  const output = Number(env[outputVar]);
  return Number.isFinite(input) && input > 0 && Number.isFinite(output) && output > 0
    ? { inputPerMTok: input, outputPerMTok: output }
    : null;
}

function priceFor(provider: RerankProviderName, model: string, env: EnvLike): RerankConfig['price'] {
  return (provider === 'gemini' ? pricePair(env, 'GEMINI_PRICE_INPUT_PER_MTOK', 'GEMINI_PRICE_OUTPUT_PER_MTOK') : null)
    ?? pricePair(env, 'RERANK_PRICE_INPUT_PER_MTOK', 'RERANK_PRICE_OUTPUT_PER_MTOK')
    ?? PRICES[model]
    ?? null;
}

/** An explicit http(s) override, else the provider's public endpoint. */
function endpoint(value: string | undefined, fallback: string): string {
  const override = value?.trim();
  return override && /^https?:\/\//.test(override) ? override.replace(/\/+$/, '') : fallback;
}

type Selection = { provider: RerankProviderName; off: string | null };

/**
 * RERANK_PROVIDER picks the provider; unset means Gemini when its key is set,
 * else Anthropic when its key is set. An explicit choice never falls back to
 * the other provider: a missing key turns the reranker off instead.
 */
function selectProvider(env: EnvLike, keys: Record<RerankProviderName, string | null>): Selection {
  const auto: RerankProviderName = keys.gemini === null && keys.anthropic !== null ? 'anthropic' : 'gemini';
  const raw = env['RERANK_PROVIDER']?.trim().toLowerCase() || 'auto';
  if (raw === 'gemini' || raw === 'anthropic') return { provider: raw, off: null };
  if (raw === 'auto') return { provider: auto, off: null };
  if (raw === 'off') return { provider: auto, off: 'RERANK_PROVIDER=off' };
  return { provider: auto, off: `unknown RERANK_PROVIDER "${raw}"` };
}

export function rerankConfigFromEnv(env: EnvLike): RerankConfig {
  const keys: Record<RerankProviderName, string | null> = {
    gemini: env['GEMINI_API_KEY']?.trim() || null,
    anthropic: env['ANTHROPIC_API_KEY']?.trim() || null,
  };
  const { provider, off } = selectProvider(env, keys);
  const gemini = provider === 'gemini';
  const apiKey = keys[provider];
  const model = gemini
    ? env['GEMINI_MODEL']?.trim() || DEFAULT_GEMINI_MODEL
    : env['ANTHROPIC_MODEL']?.trim() || DEFAULT_MODEL;
  const switchedOff = env['MXIK_LLM_ENABLED']?.trim().toLowerCase() === 'false';
  // Deliberately NOT ANTHROPIC_BASE_URL: agent tooling sets that variable for its
  // own routing, and inheriting it would send the caller's key somewhere else.
  const baseUrl = gemini
    ? endpoint(env['MXIK_GEMINI_BASE_URL'], 'https://generativelanguage.googleapis.com')
    : endpoint(env['MXIK_ANTHROPIC_BASE_URL'], 'https://api.anthropic.com');

  const rawEffort = env['ANTHROPIC_EFFORT']?.trim().toLowerCase();
  const effort: Effort | null = gemini
    ? null
    : rawEffort === undefined ? 'low' : EFFORTS.has(rawEffort as Effort) ? (rawEffort as Effort) : null;
  // -1 asks Gemini for dynamic thinking, 0 switches it off (Flash models only).
  const rawBudget = env['GEMINI_THINKING_BUDGET']?.trim();
  const rawLevel = env['GEMINI_THINKING_LEVEL']?.trim().toLowerCase();
  const thinkingLevel = gemini && THINKING_LEVELS.has(rawLevel as ThinkingLevel) ? (rawLevel as ThinkingLevel) : null;
  const thinkingBudget = gemini && rawBudget && thinkingLevel === null ? Math.round(num(rawBudget, -1, -1, 32_768)) : null;

  const disabledReason = switchedOff
    ? 'MXIK_LLM_ENABLED=false'
    : off ?? (apiKey === null ? `no ${gemini ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'}` : null);

  return {
    enabled: disabledReason === null,
    disabledReason,
    provider,
    name: `${provider}:${model}`,
    apiKey,
    model,
    baseUrl,
    effort,
    fallbacks: !gemini && env['ANTHROPIC_FALLBACKS']?.trim().toLowerCase() !== 'off' && FALLBACK_MODELS.has(model),
    thinkingBudget,
    thinkingLevel,
    gate: {
      minConfidence: num(env['RERANK_GATE_CONFIDENCE'], DEFAULT_GATE.minConfidence, 0, 1.01),
      minMargin: num(env['RERANK_GATE_MARGIN'], DEFAULT_GATE.minMargin, 0, 1),
    },
    batchSize: Math.round(num(env['RERANK_BATCH_SIZE'], 8, 1, 25)),
    batchWaitMs: Math.round(num(env['RERANK_BATCH_WAIT_MS'], 30, 0, 2000)),
    timeoutMs: Math.round(num(env['RERANK_TIMEOUT_MS'], 60_000, 1000, 600_000)),
    maxRetries: Math.round(num(env['RERANK_MAX_RETRIES'], 2, 0, 5)),
    price: priceFor(provider, model, env),
  };
}

/**
 * The Anthropic settings whatever RERANK_PROVIDER says, for callers that only
 * speak Claude (bank operation suggestions), so they are never handed another
 * provider's key or endpoint.
 */
export function anthropicConfigFromEnv(env: EnvLike): RerankConfig {
  return rerankConfigFromEnv({ ...env, RERANK_PROVIDER: 'anthropic' });
}

// One Gemini call per batch of rows, over the Generative Language REST API with
// plain fetch. Same prompt and parsing as the Claude client; JSON mode with a
// response schema converted from OUTPUT_SCHEMA. Retries 429, 5xx, timeouts and
// network errors with backoff, honouring the server's own retry delay; a daily
// quota or a delay longer than MAX_WAIT_MS fails the batch at once, and the
// pipeline keeps those rows on the capped non-LLM ranking.
import type { BatchReply, BatchRow, RerankClient } from './rerank-claude.js';
import type { RerankConfig } from './rerank-config.js';
import { parseJson, splitBatch } from './rerank-parse.js';
import { buildBatchPrompt, OUTPUT_SCHEMA, SYSTEM_PROMPT } from './rerank-prompt.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type GeminiClientDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** 0..1, for backoff jitter. */
  random?: () => number;
};

type GeminiConfig = Pick<RerankConfig, 'apiKey' | 'model' | 'baseUrl' | 'timeoutMs' | 'maxRetries' | 'thinkingBudget' | 'thinkingLevel'>;

/** Longest wait between attempts; a longer server-requested delay fails the batch instead. */
export const MAX_WAIT_MS = 90_000;
const BASE_BACKOFF_MS = 2_000;
// A 25-row batch answers in ~8k tokens; the rest is room for thinking.
const MAX_OUTPUT_TOKENS = 32_768;

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
/** Finish reasons that mean the model would not answer, as opposed to running out of room. */
const DECLINED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE', 'IMAGE_SAFETY', 'OTHER']);

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: readonly string[];
  enum?: readonly string[];
  description?: string;
  additionalProperties?: boolean;
};

/**
 * JSON Schema → Gemini's OpenAPI-subset Schema: upper-case type names, an
 * explicit propertyOrdering (Gemini otherwise orders keys alphabetically), and
 * no additionalProperties, which the dialect rejects. Any other keyword is an
 * error, so a schema change cannot be silently dropped.
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const known = new Set(['type', 'properties', 'items', 'required', 'enum', 'description', 'additionalProperties']);
  const unknown = Object.keys(schema).filter((k) => !known.has(k));
  if (unknown.length > 0) throw new Error(`toGeminiSchema: unsupported keyword(s) ${unknown.join(', ')}`);

  const out: Record<string, unknown> = {};
  if (schema.type) out['type'] = schema.type.toUpperCase();
  if (schema.description) out['description'] = schema.description;
  if (schema.enum) out['enum'] = [...schema.enum];
  if (schema.properties) {
    out['properties'] = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
    out['propertyOrdering'] = Object.keys(schema.properties);
  }
  if (schema.required) out['required'] = [...schema.required];
  if (schema.items) out['items'] = toGeminiSchema(schema.items);
  return out;
}

export const GEMINI_RESPONSE_SCHEMA = toGeminiSchema(OUTPUT_SCHEMA);

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
};

type GeminiError = {
  error?: {
    status?: string;
    message?: string;
    details?: { '@type'?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
};

/** Thrown for an answer that is final: no retry will change it. */
class FinalError extends Error {}

/** Retry-After in seconds or as an HTTP date, else Gemini's RetryInfo "37s"/"1.5s". Null when absent. */
export function retryDelayMs(headers: Headers, body: GeminiError | undefined, now = Date.now()): number | null {
  const header = headers.get('retry-after')?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - now);
  }
  for (const detail of body?.error?.details ?? []) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay?.trim() ?? '');
    if (match) return Number(match[1]) * 1000;
  }
  return null;
}

/** True when the 429 is a per-day quota: waiting minutes will not help. */
function dailyQuota(body: GeminiError | undefined): boolean {
  return (body?.error?.details ?? []).some((d) => (d.violations ?? []).some((v) => /PerDay/i.test(v.quotaId ?? '')));
}

function describe(status: number, body: GeminiError | undefined): string {
  const detail = body?.error?.message?.replace(/\s+/g, ' ').slice(0, 160);
  return `gemini HTTP ${status}${body?.error?.status ? ` ${body.error.status}` : ''}${detail ? `: ${detail}` : ''}`;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class GeminiRerankClient implements RerankClient {
  readonly name: string;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly config: GeminiConfig, deps: GeminiClientDeps = {}) {
    this.name = `gemini:${config.model}`;
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = deps.sleep ?? realSleep;
    this.random = deps.random ?? Math.random;
  }

  /** The request body for one batch. Exported through the class for tests. */
  requestBody(rows: readonly BatchRow[]): Record<string, unknown> {
    const { thinkingBudget, thinkingLevel } = this.config;
    // The API refuses both at once; the config keeps at most one.
    const thinkingConfig = thinkingLevel !== null ? { thinkingLevel } : thinkingBudget !== null ? { thinkingBudget } : null;
    return {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildBatchPrompt(rows) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: GEMINI_RESPONSE_SCHEMA,
        temperature: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(thinkingConfig ? { thinkingConfig } : {}),
      },
    };
  }

  async rankBatch(rows: readonly BatchRow[]): Promise<BatchReply> {
    const { reply, latencyMs } = await this.post(JSON.stringify(this.requestBody(rows)));
    const meta = reply.usageMetadata;
    const usage = {
      inputTokens: meta?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output.
      outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
      latencyMs,
    };
    const empty = new Map<string, unknown>();

    const blocked = reply.promptFeedback?.blockReason;
    if (blocked) return { rows: empty, failure: `model declined the request (${blocked})`, ...usage };
    const candidate = reply.candidates?.[0];
    if (!candidate) return { rows: empty, failure: 'no answer returned', ...usage };
    const finish = candidate.finishReason ?? 'STOP';
    if (finish === 'MAX_TOKENS') return { rows: empty, failure: 'response truncated', ...usage };
    if (DECLINED.has(finish)) return { rows: empty, failure: `model declined the request (${finish})`, ...usage };

    const text = (candidate.content?.parts ?? [])
      .flatMap((part) => (part.thought || typeof part.text !== 'string' ? [] : [part.text]))
      .join('');
    const raw = parseJson(text);
    if (raw === undefined) return { rows: empty, failure: 'response was not valid JSON', ...usage };

    return { rows: splitBatch(raw, rows.map((r) => r.id)), failure: null, ...usage };
  }

  /**
   * POSTs until an attempt succeeds or a final error. `latencyMs` is the
   * successful attempt's own time, so a backoff wait never reads as model latency.
   */
  private async post(body: string): Promise<{ reply: GeminiResponse; latencyMs: number }> {
    const { baseUrl, model, apiKey, maxRetries } = this.config;
    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let lastError = 'gemini request failed';
    // Set by each failed attempt: the server's delay when it gave one, else backoff.
    let wait = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(wait);
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey ?? '' },
          body,
          signal: controller.signal,
        });
        const text = await response.text();
        if (response.ok) {
          const reply = parseJson(text);
          if (typeof reply !== 'object' || reply === null) throw new FinalError('gemini returned a non-JSON body');
          return { reply, latencyMs: Date.now() - started };
        }
        const error = parseJson(text) as GeminiError | undefined;
        lastError = describe(response.status, error);
        if (!RETRYABLE.has(response.status)) throw new FinalError(lastError);
        if (response.status === 429 && dailyQuota(error)) throw new FinalError(`${lastError} (daily quota)`);
        const asked = retryDelayMs(response.headers, error);
        if (asked !== null && asked > MAX_WAIT_MS) throw new FinalError(`${lastError} (retry in ${Math.round(asked / 1000)}s)`);
        wait = asked ?? this.backoff(attempt);
      } catch (error) {
        if (error instanceof FinalError) throw error;
        lastError = controller.signal.aborted
          ? `gemini request timed out after ${this.config.timeoutMs} ms`
          : `gemini network error: ${error instanceof Error ? error.message : String(error)}`;
        wait = this.backoff(attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`${lastError} (after ${maxRetries + 1} attempts)`);
  }

  /** Exponential with jitter: ~2s, 4s, 8s … capped at MAX_WAIT_MS. */
  private backoff(attempt: number): number {
    const base = Math.min(MAX_WAIT_MS, BASE_BACKOFF_MS * 2 ** attempt);
    return Math.round(base * (0.5 + this.random() / 2));
  }
}

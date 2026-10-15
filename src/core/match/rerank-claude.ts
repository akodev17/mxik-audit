// One Claude call per batch of rows, via the official SDK. Structured output
// only; the SDK handles timeouts and retries on transient failures.
import Anthropic from '@anthropic-ai/sdk';
import type { RerankConfig } from './rerank-config.js';
import { parseJson, splitBatch } from './rerank-parse.js';
import { buildBatchPrompt, OUTPUT_SCHEMA, SYSTEM_PROMPT } from './rerank-prompt.js';
import type { RerankRequest } from './types.js';

export type BatchRow = { id: string; request: RerankRequest };

export type BatchReply = {
  /** Raw per-row answers by batch id; validated by the caller. */
  rows: Map<string, unknown>;
  /** Set when the whole call produced nothing usable (refusal, truncation, bad JSON). */
  failure: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type RerankClient = {
  readonly name: string;
  rankBatch(rows: readonly BatchRow[]): Promise<BatchReply>;
};

export class ClaudeRerankClient implements RerankClient {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(private readonly config: RerankConfig) {
    this.name = `anthropic:${config.model}`;
    // Every credential and endpoint is explicit, so nothing is inherited from
    // ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN or a local CLI profile.
    this.client = new Anthropic({
      apiKey: config.apiKey,
      authToken: null,
      baseURL: config.baseUrl,
      timeout: config.timeoutMs,
      maxRetries: config.maxRetries,
    });
  }

  async rankBatch(rows: readonly BatchRow[]): Promise<BatchReply> {
    const started = Date.now();
    const { model, effort, fallbacks } = this.config;
    const response = await this.client.beta.messages.create({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildBatchPrompt(rows) }],
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        ...(effort ? { effort } : {}),
      },
      ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });

    const usage = {
      inputTokens: response.usage.input_tokens
        + (response.usage.cache_creation_input_tokens ?? 0)
        + (response.usage.cache_read_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
      latencyMs: Date.now() - started,
    };
    const empty = new Map<string, unknown>();

    if (response.stop_reason === 'refusal') return { rows: empty, failure: 'model declined the request', ...usage };
    if (response.stop_reason === 'max_tokens') return { rows: empty, failure: 'response truncated', ...usage };

    const text = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const raw = parseJson(text);
    if (raw === undefined) return { rows: empty, failure: 'response was not valid JSON', ...usage };

    return { rows: splitBatch(raw, rows.map((r) => r.id)), failure: null, ...usage };
  }
}

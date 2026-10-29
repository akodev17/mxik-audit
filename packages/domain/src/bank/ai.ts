// Operation suggestions from Claude for the statement lines no rule decided. Only when
// ANTHROPIC_API_KEY is set (and MXIK_LLM_ENABLED is not "false"); without a key nothing is sent
// and nothing is suggested. Each line goes out as its purpose, the counterparty's name and the
// direction of the money — never an account number, ИНН or amount — and comes back as a
// MatchCandidate with basis `ai`: shown to the reviewer, never applied without their decision.
// Same client setup as the MXIK reranker (packages/core/src/match/rerank-claude.ts).
import Anthropic from '@anthropic-ai/sdk';
import { BANK_OPERATIONS, type BankOperation } from '@tasnivo/contracts/modules/bank';
import { anthropicConfigFromEnv, type EnvLike, type RerankConfig } from '@tasnivo/core/match/rerank-config';
import { z } from 'zod';

export type SuggestRow = { id: string; purpose: string; counterparty: string; direction: 'debit' | 'credit' };
export type Suggestion = { operation: BankOperation; confidence: number; reason: string };

export interface OperationSuggester {
  readonly name: string;
  /** Suggestions by row id; rows the model could not place are absent. */
  suggest(rows: readonly SuggestRow[]): Promise<Map<string, Suggestion>>;
}

/** Lines per call and per statement: a statement of 1 000 lines with few rules costs at most four calls. */
export const AI_BATCH = 50;
export const AI_CAP = 200;

/** Long digit runs (accounts, cards, ИНН) are masked before a purpose leaves the server. */
export function maskDigits(text: string): string {
  return text.replace(/\d[\d\s-]{7,}\d/g, (run) => (run.replace(/\D/g, '').length >= 9 ? '#'.repeat(4) : run));
}

const SYSTEM = [
  'You classify Uzbek bank statement lines (Russian, Uzbek Latin or Cyrillic text) into the 1C:Accounting bank operation they most likely are.',
  `Operations: ${BANK_OPERATIONS.join(', ')}.`,
  'payment_in = a customer pays the company; payment_out = the company pays a supplier; tax = payment to the budget; salary = wages;',
  'bank_fee = the bank\'s own fee; acquiring = card terminal proceeds; transfer = between the company\'s own accounts; loan = credit or loan;',
  'other_in / other_out = anything else. Direction "credit" means money came in, "debit" means it went out.',
  'Answer only for lines you can place; confidence 0..1 is how sure you are; reason is one short sentence in Russian.',
].join(' ');

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          operation: { type: 'string', enum: [...BANK_OPERATIONS] },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
        required: ['id', 'operation', 'confidence', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['rows'],
  additionalProperties: false,
} as const;

const Reply = z.object({
  rows: z.array(z.object({ id: z.string(), operation: z.enum(BANK_OPERATIONS), confidence: z.number(), reason: z.string() })),
});

/** The prompt for one batch: masked purpose, counterparty name, direction. Exported for the test that checks nothing else leaves. */
export function batchPrompt(rows: readonly SuggestRow[]): string {
  return JSON.stringify(rows.map((r) => ({ id: r.id, purpose: maskDigits(r.purpose).slice(0, 300), counterparty: maskDigits(r.counterparty).slice(0, 120), direction: r.direction })));
}

/** Parses a model reply; anything off-schema or for an unknown id is dropped. */
export function parseReply(text: string, ids: ReadonlySet<string>): Map<string, Suggestion> {
  const out = new Map<string, Suggestion>();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return out; }
  const parsed = Reply.safeParse(raw);
  if (!parsed.success) return out;
  for (const row of parsed.data.rows) {
    if (!ids.has(row.id)) continue;
    out.set(row.id, { operation: row.operation, confidence: Math.min(1, Math.max(0, row.confidence)), reason: row.reason.slice(0, 300) });
  }
  return out;
}

export class ClaudeOperationSuggester implements OperationSuggester {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(private readonly config: RerankConfig) {
    this.name = `anthropic:${config.model}`;
    // Every credential and endpoint explicit, as in rerank-claude.ts: nothing inherited from ANTHROPIC_BASE_URL.
    this.client = new Anthropic({ apiKey: config.apiKey, authToken: null, baseURL: config.baseUrl, timeout: config.timeoutMs, maxRetries: config.maxRetries });
  }

  async suggest(rows: readonly SuggestRow[]): Promise<Map<string, Suggestion>> {
    const response = await this.client.beta.messages.create({
      model: this.config.model,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: 'user', content: batchPrompt(rows) }],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return new Map();
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return parseReply(text, new Set(rows.map((r) => r.id)));
  }
}

let override: OperationSuggester | null | undefined;

/** Tests and the benchmark replace the suggester (null = none); undefined restores the environment's. */
export function setOperationSuggester(suggester: OperationSuggester | null | undefined): void {
  override = suggester;
}

/** The suggester for this process: the override, else Claude when a key is configured, else none. */
export function operationSuggester(env: EnvLike = process.env): OperationSuggester | null {
  if (override !== undefined) return override;
  // Claude only, whichever provider RERANK_PROVIDER picks for the MXIK reranker.
  const config = anthropicConfigFromEnv(env);
  return config.enabled && config.apiKey ? new ClaudeOperationSuggester(config) : null;
}

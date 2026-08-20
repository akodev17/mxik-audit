// LLM reranking. The prompt hands Claude each candidate's full hierarchy path,
// because that is the strongest disambiguation signal the classifier offers:
// two rows with near-identical names sit under completely different groups.
import { z } from 'zod';
import { hierarchyPath } from './rules.js';
import type { RerankProvider, RerankRequest, RerankVerdict } from './types.js';

/** Only the handful of string keys this factory reads. */
type EnvLike = Record<string, string | undefined>;

const VerdictSchema = z.object({
  ranking: z.array(z.object({
    code: z.string().regex(/^\d{17}$/),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(300),
  })).min(1).max(5),
});

const SYSTEM_PROMPT = `You classify products against Uzbekistan's MXIK (IKPU) goods and services classifier.

You are given one product name from a company's catalogue, any attributes parsed out of it, and candidate MXIK codes retrieved from the official classifier. Each candidate shows its full hierarchy path (group → class → position → subposition) and its bound unit of measure.

Rules that govern the correct answer:
- A code ending in 000000 is a BASE code. Base codes are officially acceptable when no exact match exists. Prefer them unless the product is in a digitally marked category.
- A code not ending in 000000 is an IDENTIFYING code carrying a specific brand and attributes. Only prefer one when the candidate is flagged as digitally marked, or the product name clearly names that exact brand and packaging.
- Prepared dishes (palov, manti, kabob, restaurant food) deliberately have no detailed code. The general code is the right answer for them.
- The hierarchy path matters more than surface name similarity. A name that merely reads alike but sits under an unrelated group is wrong.

Rank the candidates best-first. Return at most 5. Confidence is your own 0-1 estimate that the code is the correct classification for this product; be willing to return low confidence for every candidate when none fits. Give one short sentence of reasoning each, in English.`;

function renderCandidates(request: RerankRequest): string {
  return request.candidates.map((c, i) => {
    const bits = [
      `${i + 1}. code=${c.code}`,
      `   name: ${c.nameUz}`,
      `   path: ${hierarchyPath(c) || '(unknown)'}`,
      `   kind: ${c.isBase ? 'BASE (…000000)' : 'IDENTIFYING'}`,
      `   marked: ${c.isMarked === null ? 'unknown' : c.isMarked ? 'yes' : 'no'}`,
    ];
    if (c.unitBinding === 'strict' && c.unitCanonical.length) {
      bits.push(`   bound unit (strict): ${c.unitCanonical.join(' / ')}`);
    }
    if (c.brandName) bits.push(`   brand: ${c.brandName}`);
    if (c.attributeName) bits.push(`   attribute: ${c.attributeName}`);
    return bits.join('\n');
  }).join('\n');
}

function buildUserPrompt(request: RerankRequest): string {
  const attrs = Object.entries(request.attrs)
    .filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(', ');
  return [
    `Product name: ${request.productName}`,
    attrs ? `Parsed attributes: ${attrs}` : 'Parsed attributes: none',
    '',
    'Candidates:',
    renderCandidates(request),
  ].join('\n');
}

/** Used when no key is configured: the pipeline keeps its fusion order. */
export class NoopRerankProvider implements RerankProvider {
  readonly name = 'noop (no ANTHROPIC_API_KEY)';
  readonly available = false;
  rerank(): Promise<RerankVerdict[]> {
    return Promise.resolve([]);
  }
}

export class ClaudeRerankProvider implements RerankProvider {
  readonly name: string;
  readonly available = true;

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-opus-5',
    private readonly baseUrl = 'https://api.anthropic.com',
  ) {
    this.name = `anthropic:${model}`;
  }

  async rerank(request: RerankRequest): Promise<RerankVerdict[]> {
    if (request.candidates.length === 0) return [];
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt(request) }],
        // Structured output only: a tool call the model must fill in.
        tools: [{
          name: 'submit_ranking',
          description: 'Return the ranked candidate codes.',
          input_schema: {
            type: 'object',
            properties: {
              ranking: {
                type: 'array',
                maxItems: 5,
                items: {
                  type: 'object',
                  properties: {
                    code: { type: 'string', description: 'The 17-digit MXIK code' },
                    confidence: { type: 'number', description: '0-1 confidence' },
                    reason: { type: 'string', description: 'One short sentence' },
                  },
                  required: ['code', 'confidence', 'reason'],
                },
              },
            },
            required: ['ranking'],
          },
        }],
        tool_choice: { type: 'tool', name: 'submit_ranking' },
      }),
    });

    if (!res.ok) throw new Error(`rerank failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { content?: { type: string; input?: unknown }[] };
    const toolUse = body.content?.find((c) => c.type === 'tool_use');
    if (!toolUse?.input) throw new Error('rerank response contained no tool call');

    const parsed = VerdictSchema.parse(toolUse.input);
    // Drop hallucinated codes: only codes we actually offered may be returned.
    const offered = new Set(request.candidates.map((c) => c.code));
    return parsed.ranking.filter((v) => offered.has(v.code));
  }
}

export function rerankProviderFromEnv(env: EnvLike = process.env): RerankProvider {
  const key = env['ANTHROPIC_API_KEY'];
  if (!key) return new NoopRerankProvider();
  const model = env['ANTHROPIC_MODEL'] ?? 'claude-opus-5';
  // Deliberately NOT ANTHROPIC_BASE_URL: agent tooling sets that variable for its
  // own routing, and inheriting it would send the caller's key to an endpoint
  // they never chose. The override has to be asked for by name.
  const baseUrl = env['MXIK_ANTHROPIC_BASE_URL'];
  return new ClaudeRerankProvider(key, model, baseUrl && /^https?:\/\//.test(baseUrl) ? baseUrl : undefined);
}

export { SYSTEM_PROMPT, buildUserPrompt };

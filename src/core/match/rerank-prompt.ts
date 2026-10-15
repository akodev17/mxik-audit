// What the reranker sends. Only three things about a customer row leave the
// server: its cleaned product name, its unit, and a derived prepared-dish flag.
// Everything else in the prompt is public classifier data.
import { hierarchyPath } from './rules.js';
import type { RerankRequest } from './types.js';

/** Bump when the prompt or schema changes, so cached verdicts are not reused. */
export const PROMPT_VERSION = 'v2-batch';

export const SYSTEM_PROMPT = `You classify products against Uzbekistan's MXIK (IKPU) goods and services classifier.

You receive one or more catalogue rows. Each row has a product name as a company wrote it, the row's unit of measure, and candidate MXIK codes retrieved from the official classifier. Each candidate shows its hierarchy path (group → class → position → subposition) and its bound unit.

Rules that govern the correct answer:
- A code ending in 000000 is a BASE code. Base codes are officially acceptable when no exact match exists. Prefer them unless the product is in a digitally marked category.
- A code not ending in 000000 is an IDENTIFYING code carrying a specific brand and attributes. Only prefer one when the candidate is flagged as digitally marked, or the product name clearly names that exact brand and packaging.
- Prepared dishes (palov, manti, kabob, restaurant food) deliberately have no detailed code. The general code is the right answer for them.
- The hierarchy path matters more than surface name similarity. A name that reads alike but sits under an unrelated group is wrong.

For every row, rank at most 5 of that row's own candidate codes, best first. You may only use codes listed for that row; never invent or modify a code. If no candidate is a defensible classification, set "none" to true and return an empty ranking. Confidence is your own 0-1 estimate that the code is correct. Give one short sentence of reasoning per code, in English. Return exactly one entry per row id.`;

/** Structured-output schema. Bounds are re-checked by the parser, not trusted. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          none: { type: 'boolean' },
          ranking: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                confidence: { type: 'number' },
                reason: { type: 'string' },
              },
              required: ['code', 'confidence', 'reason'],
              additionalProperties: false,
            },
          },
        },
        required: ['id', 'none', 'ranking'],
        additionalProperties: false,
      },
    },
  },
  required: ['rows'],
  additionalProperties: false,
} as const;

function renderCandidates(request: RerankRequest): string {
  return request.candidates.map((c, i) => {
    const bits = [
      `  ${i + 1}. code=${c.code}`,
      `     name: ${c.nameUz}`,
      `     path: ${hierarchyPath(c) || '(unknown)'}`,
      `     kind: ${c.isBase ? 'BASE (…000000)' : 'IDENTIFYING'}`,
      `     marked: ${c.isMarked === null ? 'unknown' : c.isMarked ? 'yes' : 'no'}`,
    ];
    if (c.unitBinding === 'strict' && c.unitCanonical.length) {
      bits.push(`     bound unit (strict): ${c.unitCanonical.join(' / ')}`);
    }
    if (c.brandName) bits.push(`     brand: ${c.brandName}`);
    if (c.attributeName) bits.push(`     attribute: ${c.attributeName}`);
    return bits.join('\n');
  }).join('\n');
}

/** One row block. `id` is a batch-local label, never a database id. */
export function renderRow(id: string, request: RerankRequest): string {
  return [
    `Row ${id}`,
    `  product name: ${request.productName}`,
    `  unit: ${request.unit ?? '(not given)'}`,
    `  prepared dish: ${request.preparedDish ? 'yes' : 'no'}`,
    '  candidates:',
    renderCandidates(request),
  ].join('\n');
}

export function buildBatchPrompt(rows: readonly { id: string; request: RerankRequest }[]): string {
  return rows.map((r) => renderRow(r.id, r.request)).join('\n\n');
}

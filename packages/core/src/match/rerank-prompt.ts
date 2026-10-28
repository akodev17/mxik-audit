// What the reranker sends. Only two things about a customer row leave the
// server: its cleaned product name and its unit. Everything else in the prompt
// is public classifier data.
import { hierarchyPath } from './rules.js';
import type { RerankRequest } from './types.js';

/** Bump when the prompt or schema changes, so cached verdicts are not reused. */
export const PROMPT_VERSION = 'v5-uz';

// v4 (2026-10-28, first real runs): v3 made every model answer "none" when the
// right product type was offered only with other sizes or brands (pipe rows
// with 100-114 mm variants for a 15 mm pipe), which empties the suggestion. "none"
// is now kept for a wrong product type; an attribute mismatch is a low-confidence
// ranking instead. v5: the schema asks for the ranking before "none", and a
// "none" that comes with a ranking is read as the ranking (rerank-parse.ts):
// in 25-row batches flash-lite still answered "none" for those pipe rows.
export const SYSTEM_PROMPT = `You classify products against Uzbekistan's MXIK (IKPU) goods and services classifier.

You receive one or more catalogue rows. Each row has a product name as a company wrote it, the row's unit of measure, and candidate MXIK codes retrieved from the official classifier. Each candidate shows its hierarchy path (group → class → position → subposition) and its bound unit.

Rules that govern the correct answer:
- First decide what kind of product the row is. The hierarchy path matters more than surface name similarity: a name that reads alike but sits under an unrelated group is wrong.
- A code ending in 000000 is a BASE code. Base codes are officially acceptable when no exact match exists. Prefer the base code of the right subposition when it is offered and the name does not identify one specific variant, unless the product is in a digitally marked category.
- A code not ending in 000000 is an IDENTIFYING code carrying a specific brand and attributes. Prefer it when the candidate is flagged as digitally marked, or when the product name names that brand or matches its attributes (size, thickness, grade, dosage, pack count, volume).
- When the right kind of product is offered only as identifying codes whose attributes differ from the name (another size, brand or packaging), still rank them: the closest attributes first, with confidence well below 0.7, because the product type is right and a reviewer can pick the exact variant.
- Prepared dishes (palov, manti, kabob, restaurant food) deliberately have no detailed code. The general code is the right answer for them.
- A unit of measure that differs from a candidate's bound unit lowers confidence; on its own it does not make the product type wrong.

For every row, rank at most 5 of that row's own candidate codes, best first. You may only use codes listed for that row; never invent or modify a code. Write the ranking first. Set "none" to true, with an empty ranking, only when every candidate is a different kind of product. Confidence is your own 0-1 estimate that the code is correct. Give exactly one short sentence of reasoning per code, in Uzbek (Latin script), written for an accountant: name the deciding fact (product type, group, unit), no hedging. Return exactly one entry per row id.`;

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
          none: { type: 'boolean' },
        },
        required: ['id', 'ranking', 'none'],
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
    '  candidates:',
    renderCandidates(request),
  ].join('\n');
}

export function buildBatchPrompt(rows: readonly { id: string; request: RerankRequest }[]): string {
  return rows.map((r) => renderRow(r.id, r.request)).join('\n\n');
}

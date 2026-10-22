// Strict parsing of the reranker's JSON. Pure. Nothing the model returns is
// trusted: shape, bounds and every code are checked, and anything outside the
// row's own candidate list is dropped.
import { z } from 'zod';
import type { RerankVerdict } from './types.js';

const RowSchema = z.object({
  id: z.string().min(1),
  none: z.boolean(),
  ranking: z.array(z.object({
    code: z.string(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(1000),
  })).max(5),
});

const OutputSchema = z.object({ rows: z.array(z.unknown()) });

/** Reason shown to reviewers when the model rejects every candidate. */
export const NONE_REASON = 'Topilgan nomzodlarning hech biri bu tovarga mos emas.';

/** Keeps the first sentence only, capped, so the UI shows one line. */
export function oneSentence(text: string, max = 200): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const end = trimmed.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1);
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export type RowVerdicts = {
  verdicts: RerankVerdict[];
  /** Codes returned for this row that were not among its candidates. */
  discarded: number;
};

/**
 * Validates one row's answer against the codes that were offered for it.
 * "none" scores every offered code at 0, so the row drops out of every band a
 * reviewer might trust. Null when nothing usable remains.
 */
export function rowVerdicts(raw: unknown, offered: readonly string[]): RowVerdicts | null {
  const parsed = RowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const allowed = new Set(offered);

  if (parsed.data.none) {
    return {
      verdicts: offered.map((code) => ({ code, confidence: 0, reason: NONE_REASON })),
      discarded: 0,
    };
  }

  const seen = new Set<string>();
  const verdicts: RerankVerdict[] = [];
  let discarded = 0;
  for (const v of parsed.data.ranking) {
    const code = v.code.trim();
    if (!/^\d{17}$/.test(code) || !allowed.has(code) || seen.has(code)) {
      discarded++;
      continue;
    }
    seen.add(code);
    verdicts.push({ code, confidence: v.confidence, reason: oneSentence(v.reason) });
  }
  return verdicts.length > 0 ? { verdicts, discarded } : null;
}

/**
 * Splits a batch response by row id. Ids the model invented are ignored; ids it
 * omitted map to nothing, which the caller treats as a failed row.
 */
export function splitBatch(raw: unknown, ids: readonly string[]): Map<string, unknown> {
  const parsed = OutputSchema.safeParse(raw);
  const out = new Map<string, unknown>();
  if (!parsed.success) return out;
  const wanted = new Set(ids);
  for (const row of parsed.data.rows) {
    const id = typeof row === 'object' && row !== null ? (row as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && wanted.has(id) && !out.has(id)) out.set(id, row);
  }
  return out;
}

/** JSON.parse that returns undefined instead of throwing. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

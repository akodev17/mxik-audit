// The product intelligence interface the Didox workflow calls (docs/TASNIVO_AI_PLAN_2026-10-23.md
// §4.4). Base-commit stub: Agent 4 (feat/mxik-product-intelligence) replaces the bodies with the
// real matcher (packages/core/src/match + FirmMapping) and classifier checks.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';

export type MatchResult = z.infer<typeof accounting.MatchResult>;
export type ProductRecord = z.infer<typeof accounting.ProductRecord>;
export type ProductQuery = { name: string; mxik?: string | null; barcode?: string | null; unit?: string | null; packageCode?: string | null };
export type Classification = Pick<ProductRecord, 'mxik' | 'mxikName' | 'mxikStatus' | 'mxikSuggestion' | 'packageCode' | 'packageName' | 'markingRequired'>;

/** Matches each line against the org's (and client's) products and confirmed mappings. */
export function matchProducts(_orgId: string, _clientId: string | null, lines: ProductQuery[]): Promise<MatchResult[]> {
  return Promise.resolve(lines.map(() => ({ status: 'unknown' as const, chosen: null, candidates: [] })));
}

/** Checks each line's MXIK against the classifier (validity, activity, restriction) and suggests a code when it is missing or doubtful. */
export function classifyProducts(_orgId: string, lines: ProductQuery[]): Promise<Classification[]> {
  return Promise.resolve(lines.map((l) => ({
    mxik: l.mxik ?? null, mxikName: null, mxikStatus: 'unchecked' as const, mxikSuggestion: null,
    packageCode: l.packageCode ?? null, packageName: null, markingRequired: null,
  })));
}

/** Creates or updates products from reviewed records; never overwrites a field with an empty value. */
export function upsertProducts(_orgId: string, _clientId: string | null, _records: ProductRecord[], _actorId: string): Promise<{ created: number; updated: number; ids: string[] }> {
  return Promise.resolve({ created: 0, updated: 0, ids: [] });
}

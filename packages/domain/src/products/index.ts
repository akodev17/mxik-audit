// The product intelligence interface the Didox workflow and the product catalogue call
// (docs/TASNIVO_AI_PLAN_2026-10-23.md §4.4). Signatures as in the base commit; the optional last
// arguments and the extra fields are additive (an `issues` list on each classification, `onecRef`
// on a query, the reviewer's confirmations on an upsert). Server-only.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { classify, type ClassifyOptions, type Classification as Classified } from './classify.js';
import { matchLines } from './match.js';
import { upsertRecords, type UpsertOptions } from './upsert.js';
import type { Locale } from '@tasnivo/i18n/i18n';

export type MatchResult = z.infer<typeof accounting.MatchResult>;
export type ProductRecord = z.infer<typeof accounting.ProductRecord>;
/** `onecRef`: the 1C catalogue code, when the line carries one (matched first). */
export type ProductQuery = { name: string; mxik?: string | null; barcode?: string | null; unit?: string | null; packageCode?: string | null; onecRef?: string | null };
/** The §4.4 Pick plus `issues`: the ValidationIssue list behind `mxikStatus` (codes in agent4-result.md). */
export type Classification = Classified;

/**
 * Matches each line against the org's products (the client's own and the org's shared ones) and
 * its confirmed mappings: onec_ref, barcode, MXIK + unit, exact / normalised name, alias,
 * confirmed_mapping, then name similarity. One MatchResult per line, in order.
 */
export function matchProducts(orgId: string, clientId: string | null, lines: ProductQuery[], options: { locale?: Locale } = {}): Promise<MatchResult[]> {
  return matchLines(orgId, clientId, lines, options.locale);
}

/**
 * Checks each line's MXIK against the classifier (format, existence, activity, restriction, a name
 * the code does not fit), its unit and packaging code against the code's bindings, and suggests a
 * code when it is missing or doubtful (firm dictionary first, the LLM reranker only for rows the
 * gate calls uncertain). One answer per line, in order.
 */
export function classifyProducts(orgId: string, lines: ProductQuery[], options: ClassifyOptions = {}): Promise<Classification[]> {
  return classify(orgId, lines, options);
}

/**
 * Creates or updates products from reviewed records; never overwrites a field with an empty value.
 * `options.confirmed` names the records whose MXIK a person confirmed: those are learned into
 * FirmMapping so the audit and future invoices reuse them.
 */
export function upsertProducts(
  orgId: string, clientId: string | null, records: ProductRecord[], actorId: string, options: UpsertOptions = {},
): Promise<{ created: number; updated: number; ids: string[] }> {
  return upsertRecords(orgId, clientId, records, actorId, options);
}

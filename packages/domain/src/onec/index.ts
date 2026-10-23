// The 1C integration interface every producing workflow calls (docs/TASNIVO_AI_PLAN_2026-10-23.md
// §4.3). This base-commit version is a stub so the bank, Didox and product workstreams compile and
// test against the signatures from day one; Agent 1 (feat/onec-integration-core) replaces the
// bodies. Never add a second 1C file builder elsewhere: every export goes through here.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import type { FileOut } from '../catalog-exports.js';

export type OneCFormat = z.infer<typeof accounting.ImportOutcome>['format'];
export type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
export type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
export type CounterpartyRef = z.infer<typeof accounting.CounterpartyRef>;

export type PrepareInput = { orgId: string; batchId: string; format: OneCFormat; recordIds?: string[] };
export type Prepared =
  | { ok: true; records: number; issues: ValidationIssue[]; checks: ImportOutcome['checks'] }
  | { ok: false; error: string };
export type Built = { ok: true; exportId: string; file: FileOut } | { ok: false; error: string };
export type Transferred = { ok: true; exportId: string; outcome: ImportOutcome } | { ok: false; error: string };

const NOT_IMPLEMENTED = { ok: false as const, error: 'not_implemented' };

/** Validates and de-duplicates the batch's approved records for `format`; reports what would go. */
export function prepareExport(_input: PrepareInput): Promise<Prepared> {
  return Promise.resolve(NOT_IMPLEMENTED);
}

/** Builds the 1C import file for the batch and records an onec_export row. */
export function buildExport(_input: PrepareInput & { actorId: string }): Promise<Built> {
  return Promise.resolve(NOT_IMPLEMENTED);
}

/** Sends the batch through the org's direct 1C connection (odata / http), when one is configured and tested. */
export function transferExport(_input: PrepareInput & { actorId: string }): Promise<Transferred> {
  return Promise.resolve(NOT_IMPLEMENTED);
}

/** Matches each ref against the org's counterparties (inn → account → normalised name → alias); fills `counterpartyId` and `match`. */
export function matchCounterparties(_orgId: string, refs: CounterpartyRef[]): Promise<CounterpartyRef[]> {
  return Promise.resolve(refs.map((r) => ({ ...r, match: { status: 'unknown', chosen: null, candidates: [] } })));
}

/** Like matchCounterparties, but creates a counterparty for every `new` ref. */
export async function recordCounterparties(orgId: string, refs: CounterpartyRef[]): Promise<CounterpartyRef[]> {
  return matchCounterparties(orgId, refs);
}

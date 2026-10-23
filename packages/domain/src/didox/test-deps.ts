// Test-only: the product and counterparty interfaces as the base commit's stubs answered them
// (no match, no classification), so the Didox tests that check the workflow's own rules stay
// independent of the matcher's and the classifier's data. didox-real.test.ts runs the real ones.
import type { CheckDeps } from './check.js';

export const baseStubDeps: CheckDeps = {
  matchProducts: (_o, _c, lines) => Promise.resolve(lines.map(() => ({ status: 'unknown' as const, chosen: null, candidates: [] }))),
  classifyProducts: (_o, lines) => Promise.resolve(lines.map((l) => ({
    mxik: l.mxik ?? null, mxikName: null, mxikStatus: 'unchecked' as const, mxikSuggestion: null,
    packageCode: l.packageCode ?? null, packageName: null, markingRequired: null, issues: [],
  }))),
  matchCounterparties: (_o, refs) => Promise.resolve(refs.map((r) => ({ ...r, match: { status: 'unknown' as const, chosen: null, candidates: [] } }))),
  productRecords: () => Promise.resolve([]),
};

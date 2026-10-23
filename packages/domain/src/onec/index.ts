// The 1C integration interface every producing workflow calls (docs/TASNIVO_AI_PLAN_2026-10-23.md
// §4.3). The signatures are the base commit's; the bodies are Agent 1's (feat/onec-integration-core).
// Never add a second 1C file builder elsewhere: every export goes through here.
//
//   prepareExport   validates and de-duplicates a batch's approved records for a format; writes nothing
//   buildExport     builds the file, records the onec_export row and every record's outcome
//   transferExport  sends the batch over the org's OData connection (implemented, NOT verified against a real 1C)
//   matchCounterparties / recordCounterparties   ИНН → account → normalised name → alias
//
// docs/accounting-2026-10-23/onec-formats.md describes the files; onec-ui.md the review grid.
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';

export type OneCFormat = z.infer<typeof accounting.ImportOutcome>['format'];
export type ValidationIssue = z.infer<typeof accounting.ValidationIssue>;
export type ImportOutcome = z.infer<typeof accounting.ImportOutcome>;
export type CounterpartyRef = z.infer<typeof accounting.CounterpartyRef>;

export { buildExport, exportFile, IDEMPOTENCY_MS, prepareExport, type Built, type PrepareInput, type Prepared } from './export.js';
export { transferExport, type Transferred } from './transfer.js';
export {
  importCounterparties, listCounterparties, matchCounterparties, recordCounterparties, type CounterpartyScope, type RecordOptions,
} from './counterparties.js';
export { normalizeName } from './normalize.js';
export { refreshCounts, statusFromIssues } from './batch-state.js';
export { batchDetail, decideMany, decideRecord, listBatches, type Actor, type Reader } from './review.js';
export { getConnection, saveConnection, testConnection, type ConnectionView, type TestResult } from './connection.js';
export { parseBankExchange, exchangeDocumentOf } from './bank-exchange.js';

// 1C integration (Agent 1, docs/TASNIVO_AI_PLAN_2026-10-23.md §4.3): the import history of every
// batch (bank statements, Didox invoices, product catalogues), one batch with its records for the
// review grid, the reviewer's decisions, "Prepare for 1C" (a dry run), the export (a stored file,
// downloaded from the history), the direct transfer, the org's 1C settings and connection test,
// and the counterparties (list, and a 1C «Контрагенты» file to load them from).
// Reads are open to anyone signed in; decisions and exports to writers; the connection to admins.
import { z } from 'zod';
import {
  BatchCounts, ImportOutcome, IMPORT_KINDS, IMPORT_STATUSES, ONEC_BANK_KEYS, ONEC_CONNECTION_KINDS, ONEC_FORMATS, RECORD_STATUSES, RecordOutcome,
  ReviewDecision, ValidationIssue,
} from '../accounting';
import { Fail, IsoDateTime, LIMITS, QueryPage, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';

const BatchPath = z.object({ batchId: ShortId });
const RecordPath = z.object({ recordId: ShortId });
const ExportPath = z.object({ exportId: ShortId });
const Format = z.enum(ONEC_FORMATS);

/** One export of a batch in its history; `hasFile` = a stored file to download (not a transfer). */
export const BatchExport = z.object({
  id: z.string(), format: Format, filename: z.string().nullable(), recordCount: z.number().int(), createdAt: IsoDateTime,
  outcome: ImportOutcome.nullable(), hasFile: z.boolean(),
});

/** accounting.ImportBatchRow plus whether each export has a file. */
export const BatchRow = z.object({
  id: z.string(),
  kind: z.enum(IMPORT_KINDS),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  source: z.string(),
  filename: z.string().nullable(),
  externalRef: z.string().nullable(),
  status: z.enum(IMPORT_STATUSES),
  counts: BatchCounts.nullable(),
  error: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  exports: z.array(BatchExport),
});
export type BatchRow = z.infer<typeof BatchRow>;

/**
 * accounting.ImportRecordRow with the payload as stored: a record the reviewer still has to fix
 * may not parse as its kind's schema yet, so the grid reads it field by field.
 */
export const RecordRow = z.object({
  id: z.string(),
  rowIndex: z.number().int(),
  status: z.enum(RECORD_STATUSES),
  payload: z.record(z.string(), z.unknown()),
  issues: z.array(ValidationIssue),
  decision: ReviewDecision.nullable(),
  decidedAt: IsoDateTime.nullable(),
  outcome: RecordOutcome.nullable(),
});
export type RecordRow = z.infer<typeof RecordRow>;

export const Check = z.object({ code: z.string(), ok: z.boolean(), detail: z.string().optional() });

const ExportRequest = z.object({ format: Format, recordIds: z.array(ShortId).min(1).max(5000).optional() });

export const ObjectTarget = z.object({
  entitySet: z.string().min(1).max(200),
  fields: z.record(z.string().max(60), z.string().max(200)),
  constants: z.record(z.string().max(200), z.union([z.string().max(500), z.number(), z.boolean()])).optional(),
  linesPart: z.string().max(200).optional(),
  lineFields: z.record(z.string().max(60), z.string().max(200)).optional(),
});
export const ObjectMap = z.object({ bankCredit: ObjectTarget, bankDebit: ObjectTarget, invoice: ObjectTarget, product: ObjectTarget });

export const Connection = z.object({
  kind: z.enum(ONEC_CONNECTION_KINDS),
  baseUrl: z.string().nullable(),
  username: z.string().nullable(),
  hasPassword: z.boolean(),
  bankKeys: z.enum(ONEC_BANK_KEYS),
  objectMap: ObjectMap,
  lastTestedAt: IsoDateTime.nullable(),
  lastOk: z.boolean().nullable(),
  lastError: z.string().nullable(),
  /** False until this connector has been run against a real 1C (none so far). */
  verifiedAgainstReal1C: z.literal(false),
});
export type Connection = z.infer<typeof Connection>;

export const CounterpartyRow = z.object({
  id: z.string(), clientId: z.string().nullable(), name: z.string(), inn: z.string().nullable(), account: z.string().nullable(), mfo: z.string().nullable(),
  aliases: z.array(z.string()), onecRef: z.string().nullable(), source: z.string(), createdAt: IsoDateTime,
});

/** A refusal with the domain's machine code (`not_found`, `nothing_to_export`, `has_errors`, …) and its words. */
const Refused = Fail.extend({ code: z.string() });

export const onec = defineModule('onec', {
  batches: endpoint({
    method: 'GET', path: '/api/onec/batches', auth: 'session', role: 'any',
    summary: 'Import history: every batch (bank statement, Didox invoice, product catalogue) with its counts and exports',
    query: z.object({
      kind: z.enum(IMPORT_KINDS).optional(),
      status: z.enum(IMPORT_STATUSES).optional(),
      client: ShortId.optional(),
      page: QueryPage,
    }),
    responds: 'json',
    response: z.object({ rows: z.array(BatchRow), total: z.number().int(), pageSize: z.number().int() }),
    replaces: ['page:(app)/onec'],
  }),
  batch: endpoint({
    method: 'GET', path: '/api/onec/batches/{batchId}', auth: 'session', role: 'any',
    summary: 'One batch, a page of its records and the 1C formats it can become',
    params: BatchPath,
    query: z.object({ status: z.enum(RECORD_STATUSES).optional(), page: QueryPage }),
    responds: 'json',
    response: z.object({
      batch: BatchRow,
      /** The kind's header (BankStatementMeta, IncomingInvoiceMeta, ProductCatalogMeta) as stored. */
      meta: z.unknown(),
      records: z.array(RecordRow),
      total: z.number().int(),
      pageSize: z.number().int(),
      formats: z.array(Format),
      primary: Format,
    }),
    replaces: ['page:(app)/onec/[batchId]'],
    notes: '404 for another org\'s batch or a client the accountant may not open.',
  }),
  prepare: endpoint({
    method: 'POST', path: '/api/onec/batches/{batchId}/prepare', auth: 'session', role: 'any',
    summary: '"Prepare for 1C": what an export would contain, its issues and checks. Writes nothing',
    params: BatchPath,
    body: ExportRequest,
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), records: z.number().int(), issues: z.array(ValidationIssue), checks: z.array(Check) }), Refused]),
    replaces: ['page:(app)/onec/[batchId]#prepare'],
  }),
  exportBatch: endpoint({
    method: 'POST', path: '/api/onec/batches/{batchId}/export', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Build the 1C file, record the export and each record\'s outcome; download it from the history',
    params: BatchPath,
    body: ExportRequest,
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), exportId: z.string(), filename: z.string().nullable(), reused: z.boolean() }), Refused]),
    replaces: ['page:(app)/onec/[batchId]#export'],
    notes: 'Answers JSON, not the file, so the page can show the outcome; GET /api/onec/exports/{exportId}/file downloads it. '
      + 'The same request within 10 minutes (no decision since) answers the same export (reused: true).',
  }),
  transfer: endpoint({
    method: 'POST', path: '/api/onec/batches/{batchId}/transfer', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Send the approved records over the org\'s OData connection (not verified against a real 1C)',
    params: BatchPath,
    body: z.object({ format: z.literal('odata').default('odata'), recordIds: z.array(ShortId).min(1).max(5000).optional() }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), exportId: z.string(), outcome: ImportOutcome }), Refused]),
    replaces: ['page:(app)/onec/[batchId]#transfer'],
  }),
  exportFile: endpoint({
    method: 'GET', path: '/api/onec/exports/{exportId}/file', auth: 'session', role: 'any',
    summary: 'A stored export file: the 1C bank file (windows-1251 text) or an .xlsx',
    params: ExportPath,
    responds: 'file',
    file: { contentTypes: ['text/plain; charset=windows-1251', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], disposition: 'attachment' },
    replaces: ['page:(app)/onec/[batchId]#download'],
  }),
  decide: endpoint({
    method: 'PUT', path: '/api/onec/records/{recordId}/decision', auth: 'session', role: 'writer',
    summary: 'Approve, correct, skip or reopen one record',
    params: RecordPath,
    body: ReviewDecision,
    responds: 'json',
    response: z.union([
      z.object({ ok: z.literal(true), record: RecordRow, counts: BatchCounts, batchStatus: z.enum(IMPORT_STATUSES) }),
      Refused.extend({ field: z.string().optional() }),
    ]),
    replaces: ['page:(app)/onec/review#decide'],
  }),
  decideMany: endpoint({
    method: 'POST', path: '/api/onec/batches/{batchId}/decisions', auth: 'session', role: 'writer',
    summary: 'Approve, skip or reopen many records of a batch at once',
    params: BatchPath,
    body: z.object({ recordIds: z.array(ShortId).min(1).max(5000), decision: ReviewDecision }),
    responds: 'json',
    response: z.union([
      z.object({
        ok: z.literal(true), count: z.number().int(), refused: z.array(z.object({ id: z.string(), error: z.string() })),
        counts: BatchCounts, batchStatus: z.enum(IMPORT_STATUSES),
      }),
      Refused,
    ]),
    replaces: ['page:(app)/onec/review#decideMany'],
  }),
  connection: endpoint({
    method: 'GET', path: '/api/onec/connection', auth: 'session', role: 'admin',
    summary: 'The org\'s 1C settings and direct connection (never the password)',
    responds: 'json', response: Connection,
    replaces: ['page:(app)/onec/settings'],
  }),
  saveConnection: endpoint({
    method: 'PUT', path: '/api/onec/connection', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Save the 1C settings: bank file keys, connection kind, address, user, password (sealed), object map',
    body: z.object({
      kind: z.enum(ONEC_CONNECTION_KINDS),
      baseUrl: z.string().max(500).nullable().optional(),
      username: z.string().max(200).nullable().optional(),
      /** Absent = keep the stored password; '' = remove it. */
      password: z.string().max(500).optional(),
      bankKeys: z.enum(ONEC_BANK_KEYS).optional(),
      objectMap: ObjectMap.optional(),
    }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), connection: Connection }), Refused]),
    replaces: ['page:(app)/onec/settings#save'],
  }),
  testConnection: endpoint({
    method: 'POST', path: '/api/onec/connection/test', auth: 'session', role: 'admin', noDemo: true,
    summary: 'GET the OData $metadata (or the HTTP base) with the stored credentials, 10 s timeout',
    responds: 'json',
    response: z.object({
      ok: z.boolean(), status: z.number().int().nullable(), code: z.string(), entitySets: z.number().int().nullable(), missing: z.array(z.string()), testedAt: IsoDateTime,
    }),
    replaces: ['page:(app)/onec/settings#test'],
  }),
  counterparties: endpoint({
    method: 'GET', path: '/api/onec/counterparties', auth: 'session', role: 'any',
    summary: 'The org\'s counterparties (by name, ИНН or account), for a client or all',
    query: z.object({ q: z.string().max(100).optional(), client: ShortId.optional(), page: QueryPage }),
    responds: 'json', response: z.object({ rows: z.array(CounterpartyRow), total: z.number().int(), pageSize: z.number().int() }),
    replaces: ['page:(app)/onec/settings#counterparties'],
  }),
  importCounterparties: endpoint({
    method: 'POST', path: '/api/onec/counterparties/import', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Load counterparties from a 1C «Контрагенты» export (Наименование, ИНН, Расчетный счет, МФО)',
    multipart: {
      fields: z.object({ clientId: ShortId.optional() }),
      files: { file: { required: true, maxBytes: LIMITS.uploadBytes, extensions: LIMITS.uploadExtensions, description: 'Excel (.xlsx) or CSV.' } },
    },
    responds: 'json',
    response: z.union([
      z.object({
        ok: z.literal(true), rows: z.number().int(), created: z.number().int(), updated: z.number().int(), skipped: z.number().int(),
        errors: z.array(z.object({ row: z.number().int(), reason: z.string() })),
      }),
      Refused,
    ]),
    replaces: ['page:(app)/onec/settings#importCounterparties'],
  }),
});

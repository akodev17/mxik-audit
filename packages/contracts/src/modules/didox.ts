// Didox incoming invoices: fetch or upload, match products, review and prepare for 1C (Agent 3,
// docs/TASNIVO_AI_PLAN_2026-10-23.md). One import_batch (kind didox_invoice) per invoice, one
// import_record per line with the accounting.InvoiceLine payload. The document shape and the API
// follow Didox's official integrator docs (tmp/real-docs/didox/RESEARCH.md §1–2); still unverified
// against a live Didox account (no sandbox token yet).
import { z } from 'zod';
import { IncomingInvoiceMeta, InvoiceLine, MatchCandidate, ValidationIssue } from '../accounting';
import { Fail, Id, IsoDateTime, OkFlag } from '../common';
import { defineModule, endpoint } from '../endpoint';

const BatchPath = z.object({ batchId: Id });
const RecordPath = z.object({ recordId: Id });
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const MB = 1024 * 1024;
/** Didox zip export, a document JSON, or an ЭСФ spreadsheet. */
const DidoxFile = { required: true, maxBytes: 20 * MB, extensions: ['.zip', '.json', '.xlsx', '.xls', '.csv'], description: 'Didox archive (.zip), document JSON, or ЭСФ Excel.' } as const;

export const DIDOX_SOURCES = ['didox_api', 'didox_zip', 'didox_json', 'xlsx'] as const;
/** Issue codes the module emits; each has a label in didoxX.issues (uz, ru). */
export const DIDOX_ISSUES = [
  'mxik_missing', 'mxik_invalid', 'mxik_inactive', 'mxik_restricted', 'mxik_conflict', 'product_new', 'product_ambiguous',
  'product_unchecked', 'package_mismatch', 'unit_mismatch', 'totals_mismatch', 'quantity_invalid', 'duplicate_line_name',
  'seller_unknown', 'seller_tin_invalid', 'duplicate_invoice',
  // The tax-side rules (packages/domain/src/didox/rules.ts, RESEARCH.md §5 / §7.17–32).
  'mxik_not_found', 'mxik_leading_zero', 'mxik_retired_later', 'mxik_restricted_later', 'package_not_of_code', 'unit_not_of_code',
  'measure_id_in_invoice', 'decimals_exceeded', 'number_format', 'vat_rate_unexpected', 'withoutvat_without_hasvat',
  'lgota_incomplete', 'lgota_sum_mismatch', 'lgota_not_of_code', 'vat_free_without_lgota', 'vat_not_creditable', 'compensation_code_expected',
  'origin_invalid', 'origin_mismatch', 'marks_missing', 'flag_mismatch', 'buyer_missing', 'buyer_tin_invalid', 'vat_reg_code_invalid',
  'vat_status_inactive', 'mfo_invalid', 'account_invalid', 'director_missing', 'one_sided', 'factura_type_unknown',
  'correction_without_original', 'correction_original_unknown', 'correction_number_changed', 'old_factura_on_standard',
  'date_in_future', 'date_before_contract', 'lot_id_format', 'didox_status_void', 'didox_not_signed', 'header_totals_mismatch',
] as const;
/** The ЭСФ spreadsheet's mappable columns (packages/domain/src/didox/sources.ts SHEET_FIELDS). */
export const SHEET_FIELDS = ['lineNo', 'name', 'mxik', 'barcode', 'packageName', 'quantity', 'price', 'amount', 'vatRate', 'vatAmount', 'total'] as const;

const Counts = z.object({
  total: z.number().int(), valid: z.number().int(), corrected: z.number().int(), suspicious: z.number().int(),
  unresolved: z.number().int(), skipped: z.number().int(), exported: z.number().int(),
});
const DuplicateOf = z.object({ batchId: z.string(), number: z.string(), date: z.string() });

export const InvoiceRow = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  source: z.string(),
  filename: z.string().nullable(),
  externalRef: z.string().nullable(),
  status: z.string(),
  number: z.string(),
  date: z.string(),
  sellerName: z.string(),
  sellerInn: z.string().nullable(),
  totalWithVat: z.string(),
  counts: Counts.nullable(),
  /** Lines suspicious or unresolved. */
  issues: z.number().int(),
  createdAt: IsoDateTime,
  hasPdf: z.boolean(),
});

/** The background sync as saved on the connection (packages/domain/src/didox/connection.ts SyncState). */
export const SyncState = z.object({
  status: z.enum(['running', 'done', 'failed']),
  dateFromUpdated: Ymd.nullable(),
  page: z.number().int(),
  listed: z.number().int(), imported: z.number().int(), skipped: z.number().int(), refused: z.number().int(), failed: z.number().int(),
  batchIds: z.array(z.string()),
  failures: z.array(z.object({ id: z.string(), error: z.string() })),
  startedAt: IsoDateTime, heartbeatAt: IsoDateTime, finishedAt: IsoDateTime.nullable(),
  /** The machine code that stopped the run, and Didox's own words for it. */
  error: z.string().nullable(), detail: z.string().nullable(),
  startedBy: z.string(), clientId: z.string().nullable(),
});

const ConnectionSummary = z.object({
  connected: z.boolean(), lastSyncAt: IsoDateTime.nullable(), lastError: z.string().nullable(),
  lastErrorDetail: z.string().nullable().optional(), sync: SyncState.nullable().optional(),
});

export const DidoxRecord = z.object({
  id: z.string(),
  rowIndex: z.number().int(),
  status: z.enum(['valid', 'corrected', 'suspicious', 'unresolved', 'skipped', 'exported']),
  payload: InvoiceLine,
  issues: z.array(ValidationIssue),
  decision: z.unknown(),
  decidedAt: IsoDateTime.nullable(),
  outcome: z.unknown(),
  /** Line numbers that are the same product by folded name (empty when unique). */
  sameAs: z.array(z.number().int()),
});

export const InvoiceDetail = z.object({
  invoice: InvoiceRow,
  meta: IncomingInvoiceMeta,
  batchIssues: z.array(ValidationIssue),
  verified: z.literal(false),
  note: z.string(),
  records: z.array(DidoxRecord),
  exports: z.array(z.object({ id: z.string(), format: z.string(), filename: z.string().nullable(), recordCount: z.number().int(), createdAt: IsoDateTime, outcome: z.unknown() })),
});

const UploadItem = z.union([
  z.object({ entry: z.string(), ok: z.literal(true), batchId: z.string(), lines: z.number().int() }),
  z.object({ entry: z.string(), ok: z.literal(false), error: z.string(), code: z.string(), duplicateOf: DuplicateOf.optional() }),
]);

export const SheetPreview = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  totalRows: z.number().int(),
  map: z.record(z.number().int()),
  fields: z.array(z.string()),
  /** 'didox_esf_template': the official ЭСФ template, read as a fixed preset; null = a sheet to map. */
  preset: z.enum(['didox_esf_template']).nullable(),
  /** Invoices the template holds (1 for a mapped sheet). */
  invoices: z.number().int(),
  /** The map is the one this org confirmed before for the same headers. */
  remembered: z.boolean(),
});

export const SheetHeader = z.object({
  number: z.string().min(1).max(60),
  date: Ymd,
  sellerTin: z.string().regex(/^(\d{9}|\d{14})$/),
  sellerName: z.string().min(1).max(300),
  buyerTin: z.string().optional(),
  contractNumber: z.string().max(60).optional(),
  contractDate: z.string().optional(),
});

export const Decision = z.object({
  action: z.enum(['approve', 'correct', 'skip', 'reopen']),
  /** product: a candidate id or 'new'; mxik: a 17-digit code (classifier-checked). */
  corrections: z.object({ product: z.string().min(1).max(64).optional(), mxik: z.string().max(17).optional() }).optional(),
  note: z.string().max(500).optional(),
});

export const Report = z.object({
  dryRun: z.boolean(),
  imported: z.number().int(),
  skipped: z.number().int(),
  rejected: z.number().int(),
  reasons: z.record(z.number().int()),
  newProducts: z.number().int(),
  lines: z.array(z.object({
    recordId: z.string(), lineNo: z.number().int(), name: z.string(), result: z.enum(['imported', 'skipped', 'rejected']),
    reason: z.string().nullable(), issue: z.string().nullable(), newProduct: z.boolean(),
  })),
});

export const ConnectionView = z.object({
  connected: z.boolean(),
  kind: z.enum(['token', 'partner']),
  companyTin: z.string(),
  clientId: z.string().nullable(),
  hasToken: z.boolean(),
  tokenExpiresAt: IsoDateTime.nullable(),
  partnerTokenRef: z.string().nullable(),
  lastSyncAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
  /** Didox's own words for the last failure (bounded, never a token). */
  lastErrorDetail: z.string().nullable(),
  baseUrl: z.string(),
  passwordLogin: z.boolean(),
  sync: SyncState.nullable(),
});

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const didox = defineModule('didox', {
  list: endpoint({
    method: 'GET', path: '/api/didox/invoices', auth: 'session', role: 'any',
    summary: 'The org\'s Didox invoices (50 per page, newest first) and the connection state',
    query: z.object({ clientId: z.string().max(64).optional(), status: z.string().max(20).optional(), page: z.coerce.number().int().min(0).max(1000).optional() }),
    responds: 'json', response: z.object({ rows: z.array(InvoiceRow), total: z.number().int(), pageSize: z.number().int(), connection: ConnectionSummary }),
    replaces: ['page:(app)/didox'],
  }),
  upload: endpoint({
    method: 'POST', path: '/api/didox/upload', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Upload a Didox zip export or a document JSON (one batch per invoice), or an ЭСФ spreadsheet (answers its preview)',
    multipart: { fields: z.object({ clientId: z.string().max(64).optional() }), files: { file: DidoxFile } },
    responds: 'json',
    response: z.union([
      z.object({ ok: z.literal(true), kind: z.literal('documents'), items: z.array(UploadItem), skipped: z.array(z.object({ entry: z.string(), reason: z.string() })) }),
      z.object({ ok: z.literal(true), kind: z.literal('sheet'), filename: z.string(), preview: SheetPreview }),
      Fail,
    ]),
    replaces: ['page:(app)/didox'],
    notes: 'The zip is walked for *.json documents (nested zips one level deep) through zip-guard; non-invoices are refused with their kind.',
  }),
  commitSheet: endpoint({
    method: 'POST', path: '/api/didox/upload/sheet', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Create invoices from an ЭСФ spreadsheet: the official template as it is, any other sheet with the confirmed columns and the typed header',
    multipart: { fields: z.object({ clientId: z.string().max(64).optional(), map: z.string().max(2000).optional(), header: z.string().max(2000).optional() }), files: { file: DidoxFile } },
    responds: 'json',
    response: z.union([
      z.object({ ok: z.literal(true), batchId: z.string(), batchIds: z.array(z.string()).optional(), items: z.array(UploadItem).optional() }),
      Fail.extend({ duplicateOf: DuplicateOf.optional() }),
    ]),
    replaces: ['page:(app)/didox'],
    notes: '`map` and `header` are JSON strings (the column index per field, -1 = none; the invoice header), ignored for the official template, whose header fields are read from its cells (layout from the filling instruction; no real filled template seen yet). A confirmed map is remembered per org by the header signature.',
  }),
  get: endpoint({
    method: 'GET', path: '/api/didox/invoices/{batchId}', auth: 'session', role: 'any',
    summary: 'One invoice: header, document-level issues, every line with its match, issues and decision',
    params: BatchPath,
    responds: 'json', response: InvoiceDetail,
    replaces: ['page:(app)/didox/[batchId]'],
  }),
  pdf: endpoint({
    method: 'GET', path: '/api/didox/invoices/{batchId}/pdf', auth: 'session', role: 'any',
    summary: 'The Didox print form of the invoice, when it came with one',
    params: BatchPath,
    responds: 'file', file: { contentTypes: ['application/pdf'], disposition: 'inline' },
    replaces: ['page:(app)/didox/[batchId]'],
  }),
  remove: endpoint({
    method: 'DELETE', path: '/api/didox/invoices/{batchId}', auth: 'session', role: 'writer',
    summary: 'Delete an invoice batch and its review (the cached document stays)',
    params: BatchPath,
    responds: 'json', response: OkFlag,
    replaces: ['page:(app)/didox'],
  }),
  decide: endpoint({
    method: 'PUT', path: '/api/didox/records/{recordId}/decision', auth: 'session', role: 'writer',
    summary: 'Approve, correct (product / MXIK), skip or reopen one line',
    params: RecordPath,
    body: Decision,
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), status: z.string(), counts: Counts }), Fail]),
    replaces: ['page:(app)/didox/[batchId]'],
  }),
  suggestion: endpoint({
    method: 'GET', path: '/api/didox/records/{recordId}/suggestion', auth: 'session', role: 'any',
    summary: 'The classifier\'s view of a line\'s MXIK and its suggestion, for the candidate picker',
    params: RecordPath,
    responds: 'json', response: z.object({ mxik: z.string().nullable(), name: z.string().nullable(), status: z.string(), suggestion: MatchCandidate.pick({ id: true, label: true, confidence: true, reason: true }).nullable() }),
    replaces: ['page:(app)/didox/[batchId]'],
  }),
  approveMany: endpoint({
    method: 'POST', path: '/api/didox/invoices/{batchId}/approve', auth: 'session', role: 'writer',
    summary: 'Bulk approve: the matched lines, or every line without an error or warning',
    params: BatchPath,
    body: z.object({ scope: z.enum(['matched', 'clean']) }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), approved: z.number().int(), counts: Counts }), Fail]),
    replaces: ['page:(app)/didox/[batchId]'],
  }),
  prepare: endpoint({
    method: 'POST', path: '/api/didox/invoices/{batchId}/prepare', auth: 'session', role: 'writer',
    summary: '"Prepare for 1C" dry run: what an export would import, skip and reject, line by line',
    params: BatchPath,
    responds: 'json',
    response: z.union([
      z.object({
        ok: z.literal(true), report: Report,
        onec: z.object({ ok: z.boolean(), error: z.string().optional(), records: z.number().int().optional(), issues: z.array(ValidationIssue).optional(), checks: z.array(z.object({ code: z.string(), ok: z.boolean(), detail: z.string().optional() })).optional() }),
      }),
      Fail,
    ]),
    replaces: ['page:(app)/didox/[batchId]'],
    notes: 'Calls prepareExport of packages/domain/src/onec (Agent 1); its stub answers not_implemented until merged.',
  }),
  exportFile: endpoint({
    method: 'POST', path: '/api/didox/invoices/{batchId}/export', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Build the 1C file through Agent 1: receipt_xlsx (approved lines) or nomenclature_xlsx (new products)',
    params: BatchPath,
    query: z.object({ format: z.enum(['receipt_xlsx', 'nomenclature_xlsx']) }),
    responds: 'file', file: { contentTypes: [XLSX], disposition: 'attachment' },
    replaces: ['page:(app)/didox/[batchId]'],
    notes: 'Refusals are 409 with the reason (nothing_to_export, not_implemented while Agent 1 is not merged).',
  }),
  sync: endpoint({
    method: 'POST', path: '/api/didox/sync', auth: 'session', role: 'writer', noDemo: true,
    summary: '"Fetch new incoming invoices": start the background sync (GET /v2/documents owner=0, doctypes 002,008,023, updated since the date), one batch per new invoice',
    body: z.object({ dateFromUpdated: Ymd.optional().or(z.literal('')), dateFrom: Ymd.optional().or(z.literal('')) }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), state: SyncState }), Fail]),
    replaces: ['page:(app)/didox'],
    notes: 'Answers at once; the run saves its state after every page and GET /api/didox/sync resumes it after an API restart. Built on the official integrator docs; verified only against the local fake server.',
  }),
  syncStatus: endpoint({
    method: 'GET', path: '/api/didox/sync', auth: 'session', role: 'any',
    summary: 'The background sync\'s state (counters, Didox\'s words on failure); resumes a run whose heartbeat stopped',
    responds: 'json', response: z.object({ state: SyncState.nullable() }),
    replaces: ['page:(app)/didox'],
  }),
  connection: endpoint({
    method: 'GET', path: '/api/didox/connection', auth: 'session', role: 'admin',
    summary: 'The org\'s Didox connection (never the token)',
    responds: 'json', response: ConnectionView,
    replaces: ['page:(app)/didox/settings'],
  }),
  saveConnection: endpoint({
    method: 'PUT', path: '/api/didox/connection', auth: 'session', role: 'admin', noDemo: true,
    summary: 'Save the connection: auth model, company TIN, pasted token (sealed), client',
    body: z.object({
      kind: z.enum(['token', 'partner']), companyTin: z.string(), token: z.string().max(4000).optional(),
      tokenExpiresAt: z.string().optional(), partnerTokenRef: z.string().optional(), clientId: z.string().optional(),
    }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true) }), Fail]),
    replaces: ['page:(app)/didox/settings'],
  }),
  removeConnection: endpoint({
    method: 'DELETE', path: '/api/didox/connection', auth: 'session', role: 'admin',
    summary: 'Forget the stored token',
    responds: 'json', response: OkFlag,
    replaces: ['page:(app)/didox/settings'],
  }),
  testConnection: endpoint({
    method: 'POST', path: '/api/didox/connection/test', auth: 'session', role: 'admin',
    summary: 'Reach Didox (public measures list) and, with the token, one authorised list call',
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), reachable: z.boolean(), authorized: z.boolean(), measures: z.number().int() }), Fail]),
    replaces: ['page:(app)/didox/settings'],
  }),
  passwordLogin: endpoint({
    method: 'POST', path: '/api/didox/connection/login', auth: 'session', role: 'admin', noDemo: true,
    summary: 'ИНН + password → Didox token (off unless DIDOX_PASSWORD_LOGIN=1; endpoint existence unverified)',
    body: z.object({ companyTin: z.string(), password: z.string().max(200) }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true) }), Fail]),
    replaces: ['page:(app)/didox/settings'],
  }),
});

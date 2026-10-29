// Catalogues: the upload wizard (preview → diagnose → commit), progress, the list, versions and
// their diff, the report, the exports, share links and review assignment.
import { z } from 'zod';
import { CATALOG_STATUSES, ColumnMap, COLUMN_FIELDS, DECISION_SOURCES, Fail, Id, IsoDateTime, LIMITS, Ok, OkFlag, QueryPage, ShortId } from '../common';
import { defineModule, endpoint } from '../endpoint';

const CatalogPath = z.object({ catalogId: Id });
const Field = z.enum(COLUMN_FIELDS);

const Counted = z.object({ count: z.number().int(), sample: z.array(z.number().int()) });

/** import-diagnostics.ts ImportDiagnostics. */
export const ImportDiagnostics = z.object({
  rows: z.number().int(),
  importable: z.number().int(),
  noName: Counted,
  duplicates: Counted.extend({ groups: z.number().int() }),
  noCode: Counted,
  badCodes: Counted,
  lostZero: Counted,
  ambiguousAmounts: Counted,
  badTnved: Counted.default({ count: 0, sample: [] }),
  tnvedZero: Counted.default({ count: 0, sample: [] }),
});

/** spreadsheet.ts ParseMeta. */
export const ParseMeta = z.object({
  format: z.enum(['xlsx', 'csv']),
  encoding: z.enum(['utf-8', 'windows-1251']).nullable(),
  delimiter: z.enum([';', ',', '\t']).nullable(),
  headerRow: z.number().int(),
  skippedAbove: z.number().int(),
  emptyRowsSkipped: z.number().int(),
  repeatedHeadersSkipped: z.number().int().optional(),
  totalSeen: z.number().int(),
  truncated: z.boolean(),
  lineJumps: z.array(z.tuple([z.number().int(), z.number().int()])).nullable().optional(),
});

/** column-map.ts MappingIssue. */
export const MappingIssue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('out_of_range'), field: Field }),
  z.object({ kind: z.literal('duplicate'), fields: z.array(Field), column: z.number().int() }),
]);

const FieldSource = z.enum(['remembered', 'guess', 'none']);

/** upload-preview.ts UploadPreview. */
export const UploadPreview = z.object({
  catalogId: z.string(),
  filename: z.string(),
  client: z.object({ id: z.string(), name: z.string() }),
  headers: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  rows: z.number().int(),
  parse: ParseMeta.nullable(),
  mapping: ColumnMap,
  remembered: z.enum(['client', 'org']).nullable(),
  fields: z.object(Object.fromEntries(COLUMN_FIELDS.map((f) => [f, FieldSource])) as Record<(typeof COLUMN_FIELDS)[number], typeof FieldSource>),
  diagnostics: ImportDiagnostics.nullable(),
  previous: z.object({ id: z.string(), filename: z.string(), createdAt: IsoDateTime, rowCount: z.number().int() }).nullable(),
});

/** upload-progress.ts UploadProgress. */
export const UploadProgress = z.discriminatedUnion('status', [
  z.object({ status: z.literal('uploaded') }),
  z.object({ status: z.literal('analyzing'), done: z.number().int(), total: z.number().int(), etaSeconds: z.number().nullable() }),
  z.object({ status: z.literal('failed') }),
  z.object({
    status: z.literal('ready'),
    summary: z.object({
      rows: z.number().int(),
      riskyRows: z.number().int(),
      byType: z.array(z.object({ type: z.string(), count: z.number().int() })),
      carried: z.number().int(),
      previousId: z.string().nullable(),
      notRead: z.number().int(),
      dropped: z.number().int(),
    }),
  }),
]);

/** catalogs.ts CatalogListItem. */
export const CatalogListItem = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  filename: z.string(),
  rowCount: z.number().int(),
  status: z.enum(CATALOG_STATUSES),
  createdAt: IsoDateTime,
  riskyRows: z.number().int().nullable(),
  uploader: z.string().nullable(),
  viaTelegram: z.boolean(),
  repeatedName: z.boolean(),
});

const DIFF_NOTES = ['name', 'barcode', 'unit', 'code', 'classifier', 'nowRisky', 'nowSafe', 'identity'] as const;

/** versions.ts DiffRow. */
export const DiffRow = z.object({
  rowIndex: z.number().int(),
  name: z.string(),
  unit: z.string().nullable(),
  code: z.string().nullable(),
  notes: z.array(z.enum(DIFF_NOTES)).optional(),
  before: z.object({ name: z.string(), unit: z.string().nullable(), code: z.string().nullable() }).optional(),
  match: z.enum(['name', 'barcode', 'row']).optional(),
});

/** versions.ts versionDiff(). */
export const VersionDiff = z.object({
  added: z.array(DiffRow),
  removed: z.array(DiffRow),
  changed: z.array(DiffRow),
  statusChanged: z.array(DiffRow),
  reReview: z.array(DiffRow),
  counts: z.object({
    added: z.number().int(), removed: z.number().int(), changed: z.number().int(), unchanged: z.number().int(),
    statusChanged: z.number().int(), reReview: z.number().int(), carried: z.number().int(),
  }),
  previousId: z.string(),
  linked: z.boolean(),
  previous: z.object({ filename: z.string(), createdAt: IsoDateTime }),
  carried: z.array(z.object({
    rowIndex: z.number().int(), name: z.string(), type: z.string(), decision: z.enum(['accepted', 'rejected']),
    code: z.string().nullable(), decidedBy: z.string().nullable(),
  })),
});

/** pipeline-meta.ts PipelineMeta. */
export const PipelineMeta = z.object({
  embedder: z.string(),
  vectorUsable: z.boolean(),
  reranker: z.object({ enabled: z.boolean(), model: z.string().nullable(), promptVersion: z.string() }),
  degradedReasons: z.array(z.enum(['rerank_off', 'vector_off', 'vector_not_semantic', 'rerank_failed', 'vector_failed'])),
  rowsWithoutAi: z.number().int(),
  llmRowsFailed: z.number().int(),
  llmRowsNone: z.number().int(),
  vectorErrors: z.number().int(),
  rowsAudited: z.number().int(),
  fromRow: z.number().int(),
  finishedAt: z.string(),
  classifierSnapshotId: z.number().int().nullable(),
  classifierTakenAt: z.string().nullable(),
});

const Coded = z.object({ code: z.string(), name: z.string().nullable() });

/** pdf/report-data.ts ReportPdfData, as JSON: the logo as a data: URL, dates as ISO strings. */
export const ReportData = z.object({
  firmName: z.string(),
  logoUrl: z.string().nullable(),
  clientName: z.string(),
  filename: z.string(),
  generatedAt: IsoDateTime,
  classifierDate: IsoDateTime.nullable(),
  totalRows: z.number().int(),
  riskyRows: z.number().int(),
  byType: z.array(z.object({ type: z.string(), count: z.number().int() })),
  markingRows: z.number().int(),
  rows: z.array(z.object({
    rowIndex: z.number().int(),
    product: z.string(),
    type: z.string(),
    current: Coded.nullable(),
    suggested: Coded.nullable(),
    decision: z.enum(['pending', 'accepted', 'rejected']),
    chosen: Coded.nullable(),
    source: z.enum(DECISION_SOURCES).nullable(),
    automatic: z.boolean(),
    /** Internal report only; null on the client-facing one and the share page. */
    decidedBy: z.string().nullable(),
    restrictedFrom: IsoDateTime.nullable().optional(),
  })),
  truncated: z.boolean(),
  checks: z.object({ purchases: z.boolean() }),
  counts: z.object({ detected: z.number().int(), suggested: z.number().int(), decided: z.number().int(), automatic: z.number().int(), unresolved: z.number().int() }),
  rowReview: z.object({ done: z.number().int(), partial: z.number().int(), open: z.number().int() }),
  limits: z.object({ notRead: z.number().int(), totalSeen: z.number().int(), dropped: z.number().int(), badCodes: z.number().int() }).nullable(),
  pipeline: PipelineMeta.nullable(),
});

/** share.ts ShareLinkView with ISO dates (actions/share.ts ShareRow). */
export const ShareRow = z.object({
  id: z.string(),
  views: z.number().int(),
  includePdf: z.boolean(),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
  lastViewedAt: IsoDateTime.nullable(),
});

/** review-assignments.ts ReviewView. */
export const ReviewView = z.object({
  id: z.string(),
  catalogId: z.string(),
  assigneeId: z.string(),
  assigneeEmail: z.string(),
  dueOn: IsoDateTime.nullable(),
  note: z.string().nullable(),
  status: z.enum(['open', 'done']),
  overdue: z.boolean(),
  doneAt: IsoDateTime.nullable(),
});

const ReviewResult = z.union([z.object({ ok: z.literal(true), changed: z.boolean().optional() }), Fail]);
/** review-assignments.ts NOTE_MAX × 4, as the action allowed. */
const ReviewNote = z.string().max(2000).nullable();

/** The catalogue query parameter of the download routes. */
const CatalogQuery = z.object({ catalog: Id });

export const catalogs = defineModule('catalogs', {
  list: endpoint({
    method: 'GET', path: '/api/catalogs', auth: 'session', role: 'any',
    summary: 'Audited catalogues or open drafts, newest first',
    query: z.object({
      clientId: z.string().optional(), page: QueryPage, kind: z.enum(['catalogs', 'drafts']).default('catalogs'),
      /** Only catalogues in this state (kind 'catalogs'). */
      status: z.enum(['ready', 'analyzing', 'failed']).optional(),
    }),
    responds: 'json',
    response: z.object({
      items: z.array(CatalogListItem),
      total: z.number().int(),
      pageSize: z.number().int(),
      clients: z.array(z.object({ id: z.string(), name: z.string() })),
      /** The client the list is narrowed to (the header switcher's active one when none is asked for); null = all. */
      clientId: z.string().nullable().default(null),
    }),
    replaces: ['page:(app)/catalogs'],
    provisional: 'catalogs/page.tsx adds the client filter options from db.client',
  }),
  previewUpload: endpoint({
    method: 'POST', path: '/api/catalogs/preview', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Read a spreadsheet once and store its rows as an uncommitted preview',
    multipart: {
      fields: z.object({ clientId: z.string().optional() }),
      files: { file: { required: true, maxBytes: LIMITS.uploadBytes, extensions: LIMITS.uploadExtensions, description: 'Excel (.xlsx, .xls) or CSV.' } },
    },
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), preview: UploadPreview }), Fail]),
    replaces: ['action:catalog.ts#previewUpload'],
    notes: 'A 0-byte file, a wrong extension and a file over 20 MB answer { ok: false, error } in the user\'s language, as before (not 413).',
  }),
  uploadOptions: endpoint({
    method: 'GET', path: '/api/upload/options', auth: 'session', role: 'any',
    summary: 'What the upload page offers: the clients a catalogue can be uploaded for, and whether uploads are open',
    responds: 'json',
    response: z.object({ clients: z.array(z.object({ id: z.string(), name: z.string() })), uploadsOpen: z.boolean() }),
    replaces: ['page:(app)/upload#clients'],
    notes: 'Clients not archived and in the user\'s scope, the default one first, then by name. uploadsOpen is false while the plan has expired (W3b).',
  }),
  preview: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/preview', auth: 'session', role: 'any',
    summary: 'The preview of an upload still waiting for its mapping (coming back to /upload?catalog=)',
    params: CatalogPath,
    responds: 'json', response: UploadPreview.nullable(),
    replaces: ['page:(app)/upload'],
  }),
  diagnose: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/diagnose', auth: 'session', role: 'writer',
    summary: 'Check a mapping and recompute the import diagnostics',
    params: CatalogPath,
    body: z.object({ mapping: ColumnMap }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), diagnostics: ImportDiagnostics, issues: z.array(MappingIssue) }), Fail]),
    replaces: ['action:catalog.ts#diagnoseUpload'],
  }),
  commit: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/commit', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Confirm the mapping and start the audit',
    params: CatalogPath,
    body: z.object({ mapping: ColumnMap }),
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), catalogId: z.string() }), Fail.extend({ committed: z.boolean().optional() })]),
    replaces: ['action:catalog.ts#commitUpload'],
    notes: 'Claims the catalogue atomically; enqueues the audit (W1b); makes its client the active one.',
  }),
  discard: endpoint({
    method: 'DELETE', path: '/api/catalogs/{catalogId}/preview', auth: 'session', role: 'writer',
    summary: '"Start over": delete an upload that was never committed',
    params: CatalogPath,
    responds: 'json', response: z.union([Ok, Fail]),
    replaces: ['action:catalog.ts#discardUpload'],
  }),
  progress: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/progress', auth: 'session', role: 'any',
    summary: 'Audit progress, polled by the upload wizard',
    params: CatalogPath,
    responds: 'json', response: UploadProgress,
    replaces: ['route:GET /upload/progress'],
    notes: 'Old URL /upload/progress?catalog=<id>; 404 for another org\'s catalogue. Cache-Control: no-store. An analyzing audit without a heartbeat is handed to jobs() again (resumeStaleAudits), as the old route did; the worker also resumes on boot.',
  }),
  retry: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/retry', auth: 'session', role: 'writer',
    summary: 'Restart an audit that failed',
    params: CatalogPath,
    responds: 'json', response: OkFlag,
    replaces: ['action:catalog.ts#retryCatalogAudit'],
  }),
  remove: endpoint({
    method: 'DELETE', path: '/api/catalogs/{catalogId}', auth: 'session', role: 'writer',
    summary: 'Delete a catalogue and everything derived from it',
    params: CatalogPath,
    responds: 'json', response: z.union([z.object({ ok: z.literal(true), rows: z.number().int() }), Fail]),
    replaces: ['action:catalog.ts#removeCatalog'],
  }),
  get: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}', auth: 'session', role: 'any',
    summary: 'The catalogue header: status, client, classifier snapshot, pipeline notes, export lock',
    params: CatalogPath,
    responds: 'json',
    response: z.object({
      id: z.string(),
      filename: z.string(),
      status: z.enum(CATALOG_STATUSES),
      createdAt: IsoDateTime,
      rowCount: z.number().int(),
      progressDone: z.number().int(),
      previousId: z.string().nullable(),
      client: z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() }),
      demo: z.boolean(),
      pipeline: PipelineMeta.nullable(),
      /** The classifier snapshot the audit used, and a newer one when there is. */
      snapshot: z.object({ usedTakenAt: IsoDateTime.nullable(), newerTakenAt: IsoDateTime.nullable() }),
      /** Exports wait for payment (billing turned on for exports and not paid). */
      exportLocked: z.boolean(),
    }),
    replaces: ['page:(app)/catalogs/[id]'],
    provisional: 'catalogs/[id]/page.tsx and workspace-header.tsx read db.catalog and db.catalogSnapshot directly',
  }),
  summary: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/summary', auth: 'session', role: 'any',
    summary: 'Workspace totals: risky rows, reviewed, by type, markirovka, dictionary and sure-band pending',
    params: CatalogPath,
    responds: 'json',
    response: z.object({
      total: z.number().int(),
      riskyRows: z.number().int(),
      riskyFindings: z.number().int(),
      reviewed: z.number().int(),
      byType: z.record(z.number().int()),
      markingTotal: z.number().int(),
      markingRisky: z.number().int(),
      dictionaryPending: z.number().int(),
      surePending: z.number().int(),
    }),
    replaces: ['page:(app)/catalogs/[id]#summary'],
  }),
  versions: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/versions', auth: 'session', role: 'any',
    summary: 'Earlier catalogues of the same client this one can be compared with',
    params: CatalogPath,
    responds: 'json', response: z.array(z.object({ id: z.string(), filename: z.string(), createdAt: IsoDateTime })),
    replaces: ['page:(app)/catalogs/[id]/diff#candidates'],
  }),
  diff: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/diff', auth: 'session', role: 'any',
    summary: 'What changed against the previous version (or `with`), one window of rows',
    params: CatalogPath,
    query: z.object({ with: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).optional(), offset: z.coerce.number().int().min(0).optional() }),
    responds: 'json', response: VersionDiff.nullable(),
    replaces: ['page:(app)/catalogs/[id]/diff'],
  }),
  report: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/report', auth: 'session', role: 'any',
    summary: 'The report page: what the PDF prints',
    params: CatalogPath,
    responds: 'json', response: ReportData,
    replaces: ['page:(app)/catalogs/[id]/report'],
    provisional: 'report/page.tsx also shows activityPage and versionDiff; those have their own endpoints',
  }),
  exportFile: endpoint({
    method: 'GET', path: '/api/export', auth: 'session', role: 'any',
    summary: 'The uploaded file with accepted codes applied (xlsx), or the 1C file (csv / xlsx)',
    query: CatalogQuery.extend({ format: z.enum(['xlsx', '1c', '1c-xlsx']).optional() }),
    responds: 'file', file: { contentTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv; charset=utf-8'], disposition: 'attachment' },
    replaces: ['route:GET /api/export'],
    notes: '404 unknown catalogue, 409 audit not finished, 402 payment required, demo export limit. Same URL as before.',
  }),
  exportDiffCsv: endpoint({
    method: 'GET', path: '/api/catalog-diff', auth: 'session', role: 'any',
    summary: 'Every changed row against the previous version, as CSV',
    query: CatalogQuery.extend({ with: z.string().optional() }),
    responds: 'file', file: { contentTypes: ['text/csv; charset=utf-8'], disposition: 'attachment' },
    replaces: ['route:GET /api/catalog-diff'],
  }),
  exportReportCsv: endpoint({
    method: 'GET', path: '/api/catalog-report-csv', auth: 'session', role: 'any',
    summary: 'The report\'s risky findings with suggestions and decisions, as CSV',
    query: CatalogQuery,
    responds: 'file', file: { contentTypes: ['text/csv; charset=utf-8'], disposition: 'attachment' },
    replaces: ['route:GET /api/catalog-report-csv'],
  }),
  exportPdf: endpoint({
    method: 'GET', path: '/api/report-pdf', auth: 'session', role: 'any',
    summary: 'Report PDF: internal, or client-facing with audience=client; download=1 for an attachment',
    query: CatalogQuery.extend({ audience: z.enum(['internal', 'client']).optional(), download: z.enum(['1']).optional() }),
    responds: 'file', file: { contentTypes: ['application/pdf'], disposition: 'either' },
    replaces: ['route:GET /api/report-pdf'],
  }),
  shareLinks: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/share-links', auth: 'session', role: 'writer',
    summary: 'Read-only report links of a catalogue',
    params: CatalogPath,
    responds: 'json', response: z.array(ShareRow),
    replaces: ['action:share.ts#shareList'],
  }),
  createShareLink: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/share-links', auth: 'session', role: 'writer',
    summary: 'A new report link for 7 or 30 days; the URL is shown once',
    params: CatalogPath,
    body: z.object({ days: z.union([z.literal(7), z.literal(30)]), includePdf: z.boolean() }),
    responds: 'json', response: z.object({ url: z.string() }).nullable(),
    replaces: ['action:share.ts#shareCreate'],
    notes: 'A plan without client links (billing/plans.ts PLAN_FEATURES) answers 403 plan_feature with a message to show.',
  }),
  revokeShareLink: endpoint({
    method: 'DELETE', path: '/api/share-links/{linkId}', auth: 'session', role: 'writer',
    summary: 'Revoke a report link',
    params: z.object({ linkId: Id }),
    responds: 'json', response: z.boolean(),
    replaces: ['action:share.ts#shareRevoke'],
  }),
  review: endpoint({
    method: 'GET', path: '/api/catalogs/{catalogId}/review', auth: 'session', role: 'any',
    summary: 'The catalogue\'s review assignment and who it can be given to',
    params: CatalogPath,
    responds: 'json', response: z.object({ review: ReviewView.nullable(), assignable: z.array(z.object({ id: z.string(), email: z.string() })) }),
    replaces: ['page:(app)/catalogs/[id]#review'],
    provisional: 'review-field.tsx calls reviewsFor and assignableMembers itself',
  }),
  assignReview: endpoint({
    method: 'PUT', path: '/api/catalogs/{catalogId}/review', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Hand a ready catalogue to a team member, with an optional due date and note',
    params: CatalogPath,
    body: z.object({ assigneeId: ShortId, dueOn: z.string().max(10).nullable(), note: ReviewNote }),
    responds: 'json', response: ReviewResult,
    replaces: ['action:reviews.ts#assignCatalogReview'],
  }),
  finishReview: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/review/done', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Mark the review done (assignee or admin)',
    params: CatalogPath,
    body: z.object({ note: ReviewNote }),
    responds: 'json', response: ReviewResult,
    replaces: ['action:reviews.ts#finishCatalogReview'],
  }),
});

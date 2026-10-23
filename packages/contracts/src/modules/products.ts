// Product catalogue and MXIK intelligence (Agent 4): the org's products with their MXIK status,
// the product drawer (alternatives, Tasnif packaging, "Confirm MXIK" → firm dictionary), the bulk
// catalogue import (an import_batch of kind product_catalog, classified in chunks), "Add to product
// catalogue" from a finished audit, and the hand-over to the 1C module (nomenclature_xlsx).
import { z } from 'zod';
import { MatchCandidate, ValidationIssue, IMPORT_STATUSES, RECORD_STATUSES, ProductRecord, BatchCounts, MatchResult } from '../accounting';
import { ClientRef, Fail, Id, LIMITS, QueryPage } from '../common';
import { defineModule, endpoint } from '../endpoint';

export const PRODUCT_STATUSES = ['ok', 'missing', 'invalid', 'inactive', 'restricted', 'suspicious', 'unchecked'] as const;
export const PRODUCT_FILTERS = ['all', ...PRODUCT_STATUSES] as const;
/** Columns of a product catalogue import; `article` is recognised so it is never taken for the name, and not stored yet. */
export const PRODUCT_FIELDS = ['name', 'onecRef', 'article', 'mxik', 'packageCode', 'unit', 'barcode'] as const;

/** Which uploaded column feeds which field; -1 = not in the file. */
export const ProductColumnMap = z.object({
  name: z.number().int().min(0),
  onecRef: z.number().int().min(-1),
  article: z.number().int().min(-1),
  mxik: z.number().int().min(-1),
  packageCode: z.number().int().min(-1),
  unit: z.number().int().min(-1),
  barcode: z.number().int().min(-1),
});

export const ProductRow = z.object({
  id: z.string(),
  name: z.string(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  onecRef: z.string().nullable(),
  mxik: z.string().nullable(),
  mxikName: z.string().nullable(),
  packageCode: z.string().nullable(),
  packageName: z.string().nullable(),
  unit: z.string().nullable(),
  barcode: z.string().nullable(),
  source: z.string(),
  mxikStatus: z.enum(PRODUCT_STATUSES),
  issues: z.array(ValidationIssue),
  suggestion: MatchCandidate.nullable(),
  markingRequired: z.boolean().nullable(),
  checkedAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const PackageRow = z.object({
  code: z.string(),
  name: z.string(),
  nameRu: z.string().nullable(),
  nameUz: z.string().nullable(),
  containerName: z.string().nullable(),
  unitName: z.string().nullable(),
  parentValue: z.number().nullable(),
  parentCode: z.string().nullable(),
});

/** Outcome of a hand-over to the 1C module: a file, or "available after integration" while it is a stub. */
const OneCHandover = z.union([
  z.object({ ok: z.literal(true), exportId: z.string(), filename: z.string().nullable(), records: z.number().int(), leftOut: z.number().int() }),
  z.object({ ok: z.literal(false), unavailable: z.boolean(), error: z.string() }),
]);

const Progress = z.object({ done: z.number().int(), total: z.number().int() });

export const ProductBatch = z.object({
  id: z.string(),
  status: z.enum(IMPORT_STATUSES),
  filename: z.string().nullable(),
  clientId: z.string().nullable(),
  source: z.string(),
  counts: BatchCounts.nullable(),
  progress: Progress,
  error: z.string().nullable(),
  createdAt: z.string(),
  /** Rows the import left out (blank name), with the reason. */
  dropped: z.number().int(),
});

export const ProductImportRecord = z.object({
  id: z.string(),
  rowIndex: z.number().int(),
  status: z.enum(RECORD_STATUSES),
  payload: ProductRecord,
  issues: z.array(ValidationIssue),
  /** The match against the org's existing products, when the record was matched. */
  match: MatchResult.nullable(),
});

export const products = defineModule('products', {
  list: endpoint({
    method: 'GET', path: '/api/products', auth: 'session', role: 'any',
    summary: 'The org’s products, searched and filtered by MXIK status and client',
    query: z.object({ q: z.string().max(100).optional(), status: z.enum(PRODUCT_FILTERS).optional(), client: z.string().max(64).optional(), page: QueryPage }),
    responds: 'json',
    response: z.object({
      rows: z.array(ProductRow),
      /** Products per MXIK status under the search and client filter (not the status filter), plus all. */
      counts: z.object({
        all: z.number().int(), ok: z.number().int(), missing: z.number().int(), invalid: z.number().int(), inactive: z.number().int(),
        restricted: z.number().int(), suspicious: z.number().int(), unchecked: z.number().int(),
      }),
      total: z.number().int(),
      pageSize: z.number().int(),
      clients: z.array(ClientRef),
    }),
    replaces: ['page:(app)/products'],
  }),
  detail: endpoint({
    method: 'GET', path: '/api/products/{productId}', auth: 'session', role: 'any',
    summary: 'One product with its aliases and the runner-up codes of its last check',
    params: z.object({ productId: Id }),
    responds: 'json',
    response: z.object({ product: ProductRow, aliases: z.array(z.string()), alternatives: z.array(MatchCandidate) }),
    replaces: ['page:(app)/products'],
    notes: '404 when the product is not in the caller’s org or client scope.',
  }),
  packages: endpoint({
    method: 'GET', path: '/api/products/{productId}/packages', auth: 'session', role: 'any',
    summary: 'The Tasnif packaging codes of the product’s MXIK (cached; fetched on first ask)',
    params: z.object({ productId: Id }),
    responds: 'json',
    response: z.object({ source: z.enum(['live', 'cache', 'unavailable', 'none']), reason: z.string().nullable(), packages: z.array(PackageRow) }),
    replaces: ['page:(app)/products'],
  }),
  confirm: endpoint({
    method: 'POST', path: '/api/products/{productId}/confirm', auth: 'session', role: 'writer',
    summary: 'Confirm the product’s MXIK: sets it, re-checks it and writes it to the firm dictionary',
    params: z.object({ productId: Id }),
    body: z.object({ code: z.string().max(32) }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), product: ProductRow }), Fail]),
    replaces: ['page:(app)/products'],
  }),
  check: endpoint({
    method: 'POST', path: '/api/products/check', auth: 'session', role: 'writer',
    summary: 'Check products’ MXIK against the classifier: the given ids, or the next chunk of unchecked ones',
    body: z.object({ ids: z.array(Id).max(200).optional(), unchecked: z.boolean().optional(), clientId: z.string().max(64).optional() }),
    responds: 'json',
    response: z.object({ checked: z.number().int(), remaining: z.number().int() }),
    replaces: ['page:(app)/products'],
    notes: 'At most 100 products per call; the page calls again while `remaining` > 0 and shows the progress.',
  }),
  importPreview: endpoint({
    method: 'POST', path: '/api/products/import/preview', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Read a catalogue file: headers, sample rows and the suggested column mapping',
    multipart: {
      fields: z.object({ clientId: z.string().optional() }),
      files: { file: { required: true, maxBytes: LIMITS.uploadBytes, extensions: LIMITS.uploadExtensions, description: 'Excel (.xlsx, .xls) or CSV; a 1C «Номенклатура» list saved to Excel.' } },
    },
    responds: 'json',
    response: z.union([z.object({
      ok: z.literal(true),
      filename: z.string(),
      headers: z.array(z.string()),
      sample: z.array(z.array(z.string())),
      rowCount: z.number().int(),
      mapping: ProductColumnMap,
      mappingSource: z.enum(['remembered', 'preset', 'guess']),
      presets: z.array(z.object({ id: z.string(), verified: z.boolean(), mapping: ProductColumnMap.nullable() })),
    }), Fail]),
    replaces: ['page:(app)/products/import'],
    notes: 'Nothing is stored: the commit sends the file again with the chosen mapping.',
  }),
  importCommit: endpoint({
    method: 'POST', path: '/api/products/import', auth: 'session', role: 'writer', noDemo: true,
    summary: 'Import a catalogue file as a product_catalog batch and start checking it in chunks',
    multipart: {
      fields: z.object({ clientId: z.string().optional(), mapping: z.string().max(2000) }),
      files: { file: { required: true, maxBytes: LIMITS.uploadBytes, extensions: LIMITS.uploadExtensions } },
    },
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), batchId: z.string(), duplicate: z.boolean() }), Fail]),
    replaces: ['page:(app)/products/import'],
    notes: 'The same file again (SHA-256 of the bytes) answers the earlier batch with duplicate: true.',
  }),
  importBatch: endpoint({
    method: 'GET', path: '/api/products/import/{batchId}', auth: 'session', role: 'any',
    summary: 'A catalogue import: status, progress, counts and a page of its records',
    params: z.object({ batchId: Id }),
    query: z.object({ page: QueryPage, status: z.enum(RECORD_STATUSES).optional() }),
    responds: 'json',
    response: z.object({
      batch: ProductBatch, records: z.array(ProductImportRecord), total: z.number().int(), pageSize: z.number().int(),
      /** What a nomenclature_xlsx would carry now (1C module prepareExport); null while checking or when it cannot say. */
      onec: z.object({ records: z.number().int(), leftOut: z.number().int(), issues: z.array(ValidationIssue) }).nullable(),
    }),
    replaces: ['page:(app)/products/import'],
  }),
  importDecide: endpoint({
    method: 'PUT', path: '/api/products/import/{batchId}/records/{recordId}', auth: 'session', role: 'writer',
    summary: 'Accept a record’s suggested MXIK (or a chosen one), skip it, or reopen it',
    params: z.object({ batchId: Id, recordId: Id }),
    body: z.object({ action: z.enum(['accept_suggestion', 'set_code', 'skip', 'reopen']), code: z.string().max(32).optional() }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), record: ProductImportRecord }), Fail]),
    replaces: ['page:(app)/products/import'],
  }),
  importApply: endpoint({
    method: 'POST', path: '/api/products/import/{batchId}/apply', auth: 'session', role: 'writer',
    summary: 'Save the batch’s records (all but skipped) into the product catalogue',
    params: z.object({ batchId: Id }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), created: z.number().int(), updated: z.number().int() }), Fail]),
    replaces: ['page:(app)/products/import'],
  }),
  importExport: endpoint({
    method: 'POST', path: '/api/products/import/{batchId}/export', auth: 'session', role: 'writer',
    summary: 'Hand the batch to the 1C module as nomenclature_xlsx (prepareExport + buildExport)',
    params: z.object({ batchId: Id }),
    responds: 'json', response: OneCHandover,
    replaces: ['page:(app)/products/import'],
    notes: 'While the 1C module is the base-commit stub this answers { ok: false, unavailable: true }.',
  }),
  exportAll: endpoint({
    method: 'POST', path: '/api/products/export', auth: 'session', role: 'writer',
    summary: 'Export the catalogue (or one client’s) to 1C as nomenclature_xlsx through the 1C module',
    body: z.object({ clientId: z.string().max(64).optional(), status: z.enum(PRODUCT_FILTERS).optional() }),
    responds: 'json', response: OneCHandover,
    replaces: ['page:(app)/products'],
  }),
  fromAudit: endpoint({
    method: 'POST', path: '/api/catalogs/{catalogId}/products', auth: 'session', role: 'writer',
    summary: 'Add a finished audit’s settled rows (clean, accepted or kept) to the product catalogue',
    params: z.object({ catalogId: Id }),
    responds: 'json',
    response: z.union([z.object({ ok: z.literal(true), created: z.number().int(), updated: z.number().int(), rows: z.number().int() }), Fail]),
    replaces: ['page:(app)/catalogs/[id]'],
  }),
});

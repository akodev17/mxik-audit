// Public API v1 (/api/v1/*, `Authorization: Bearer mxk_…`). The contract is frozen: OpenAPI
// 3.0.3, version 1.1.0, the operation ids, paths, schemas and error codes of
// packages/domain/src/api/contract.ts + openapi.ts. openapi.test.ts proves buildOpenApi() emits
// the same document; public-api.test.ts proves these constants equal the domain ones.
import { z } from 'zod';
import { CATALOG_STATUSES, DECISION_SOURCES, DECISIONS, FINDING_TYPES, LIMITS, SEVERITIES } from '../common';
import { defineModule, endpoint } from '../endpoint';
import { named, openapi } from '../meta';

export const ERROR_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  plan_expired: 402,
  plan_limit: 402,
  not_found: 404,
  idempotency_in_progress: 409,
  too_large: 413,
  unreadable_file: 422,
  idempotency_key_reused: 422,
  rate_limited: 429,
  server_error: 500,
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS;
export const ERROR_CODES = Object.keys(ERROR_STATUS) as ApiErrorCode[];

export const HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  retryAfter: 'Retry-After',
  idempotencyKey: 'Idempotency-Key',
  replayed: 'Idempotent-Replayed',
} as const;

export const IDEMPOTENCY = { maxLength: 255, ttlHours: 24 } as const;

export const PAGE = {
  catalogs: { default: 50, max: 100 },
  findings: { default: 200, max: 1000 },
} as const;

/** The limit query parameter, clamped to 1..max (a missing or unreadable one is the default). */
export function pageLimit(raw: string | null | undefined, page: { default: number; max: number }): number {
  const n = raw === null || raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return page.default;
  return Math.min(page.max, Math.max(1, Math.floor(n)));
}

export const FINDING_FIELDS = {
  reason: 'Human-readable explanation in Uzbek (Latin script), for a person to read. Its wording may change between releases: do not parse it. Use type, severity and suggestedMxik, the stable machine-readable fields.',
  type: 'Stable machine-readable kind of problem. "OTHER" means a kind this server version does not know yet (a newer check written while an upgrade is rolling out): treat it as a problem to review and read reason. In the report summary such findings are counted under the key "OTHER".',
  suggestedMxik: 'Suggested 17-digit code, or null. Stable and machine-readable.',
  restrictedFrom: 'RESTRICTED only (null otherwise): the date (YYYY-MM-DD) from which electronic invoices (EHF) no longer accept the generalized code, per the published list. On a MISSING row the restricted code is the suggested one.',
} as const;

/** Every operation can answer these: no key, too many requests, an unexpected failure. */
const ALWAYS = ['unauthorized', 'rate_limited', 'server_error'] as const satisfies readonly ApiErrorCode[];

// ── Schemas ────────────────────────────────────────────────────────────────────────────────

const SCORE = 'Match score from 0 to 1. It ranks candidates; it is not a probability that the code is right.';
const CURSOR = 'Pass as ?cursor= for the next page; null on the last page.';
const findingType = () => z.enum([...FINDING_TYPES, 'OTHER']).describe(FINDING_FIELDS.type);
const severity = () => z.enum(SEVERITIES).describe('Stable and machine-readable. "info" is shown for information and never counted as risk.');
const restrictedFrom = () => z.string().date().nullable().describe(FINDING_FIELDS.restrictedFrom);
const reason = () => z.string().describe(FINDING_FIELDS.reason);
const score = () => z.number().describe(SCORE);

export const V1Error = named('Error', z.object({ error: z.object({ code: z.enum(ERROR_CODES as [ApiErrorCode, ...ApiErrorCode[]]), message: z.string() }) }));

/** Same rules as packages/domain/src/api/check.ts CheckItemSchema. */
export const CheckItem = named('CheckItem', z.object({
  name: z.string().trim().min(1).max(500),
  barcode: z.string().trim().max(32).nullish(),
  unit: z.string().trim().max(60).nullish(),
  mxik: z.string().trim().max(32).nullish().describe('The code the product has now, if any.'),
}));

/** One product, or up to API_CHECK_MAX_ITEMS of them (checked by the handler: the cap is config). */
export const CheckRequest = named('CheckRequest', z.union([
  CheckItem,
  z.object({ items: openapi(z.array(CheckItem).min(1), { extend: (c) => ({ maxItems: c.maxCheckItems }) }) }),
]));

export const Alternative = named('Alternative', z.object({ code: z.string(), name: z.string(), confidence: score() }));

export const CheckFinding = named('CheckFinding', z.object({
  type: findingType(),
  severity: severity(),
  suggestedMxik: z.string().nullable().describe(FINDING_FIELDS.suggestedMxik),
  confidence: score().nullable(),
  reason: reason(),
  alternatives: z.array(Alternative),
  restrictedFrom: restrictedFrom(),
}));

export const CheckResult = named('CheckResult', z.object({ name: z.string(), markingRequired: z.boolean(), findings: z.array(CheckFinding) }));
export const CheckResponse = named('CheckResponse', z.object({ results: z.array(CheckResult) }));

const catalogShape = {
  id: z.string(),
  filename: z.string(),
  clientId: z.string().nullable(),
  createdAt: z.string().datetime(),
  status: z.enum(CATALOG_STATUSES),
  rows: z.number().int(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }).describe('Rows audited so far.'),
};

export const Catalog = named('Catalog', z.object(catalogShape));
export const CatalogList = named('CatalogList', z.object({ catalogs: z.array(Catalog), nextCursor: z.string().nullable().describe(CURSOR) }));
export const UploadAccepted = named('UploadAccepted', z.object({ id: z.string(), status: z.literal('analyzing'), rows: z.number().int(), clientId: z.string() }));

export const Finding = named('Finding', z.object({
  id: z.string(),
  row: z.number().int().describe('Row number in the uploaded file, counting data rows from 1.'),
  name: z.string(),
  barcode: z.string().nullable(),
  unit: z.string().nullable(),
  currentMxik: z.string().nullable().describe('The code in the uploaded file.'),
  type: findingType(),
  severity: severity(),
  suggestedMxik: z.string().nullable().describe(`${FINDING_FIELDS.suggestedMxik} It takes effect only when a person accepts it.`),
  confidence: score().nullable(),
  reason: reason(),
  decision: z.enum(DECISIONS),
  decisionSource: z.enum(DECISION_SOURCES).nullable().describe('How the decision was made: by a person (manual, group, bulk, bulk_sure, dictionary) or automatically (dictionary_auto, carry_over).'),
  chosenMxik: z.string().nullable().describe('The code the reviewer chose; may differ from suggestedMxik.'),
  restrictedFrom: restrictedFrom(),
}));

export const Report = named('Report', z.object({
  ...catalogShape,
  error: z.string().nullable().describe('Set when status is "failed".'),
  summary: z.record(z.number().int()).nullable().describe('Findings per type; null until status is "ready".'),
  findings: z.array(Finding).describe('Empty until status is "ready".'),
  nextCursor: z.string().nullable().describe(CURSOR),
}));

/** limit: documented as an integer; the handler clamps any value with pageLimit() instead of refusing it. */
const limitParam = (page: { default: number; max: number }) =>
  openapi(z.string().optional().describe(`Page size; larger values are cut to ${page.max}.`), { schema: { type: 'integer', minimum: 1, maximum: page.max, default: page.default } });
const cursorParam = () => z.string().optional().describe('nextCursor of the previous page.');

// ── Endpoints ──────────────────────────────────────────────────────────────────────────────

export const publicApi = defineModule('publicApi', {
  check: endpoint({
    method: 'POST', path: '/api/v1/check', auth: 'apiKey',
    summary: (c) => `Check one product or up to ${c.maxCheckItems} at once`,
    body: CheckRequest,
    responds: 'json', response: CheckResponse,
    publicApi: {
      success: 200, idempotent: true, paginated: false, successDescription: 'Findings per product, in the order sent.', successSchema: 'CheckResponse',
      errors: [...ALWAYS, 'invalid_request', 'idempotency_in_progress', 'idempotency_key_reused', 'plan_expired', 'plan_limit'],
    },
    replaces: ['route:POST /api/v1/check'],
  }),
  listCatalogs: endpoint({
    method: 'GET', path: '/api/v1/catalogs', auth: 'apiKey',
    summary: 'List the catalogues of the key\'s organisation',
    query: z.object({ limit: limitParam(PAGE.catalogs), cursor: cursorParam(), clientId: z.string().optional().describe('Only this client\'s catalogues.') }),
    responds: 'json', response: CatalogList,
    publicApi: {
      success: 200, idempotent: false, paginated: true, successDescription: 'One page of catalogues, newest first.', successSchema: 'CatalogList',
      errors: [...ALWAYS, 'invalid_request', 'not_found'],
    },
    replaces: ['route:GET /api/v1/catalogs'],
  }),
  uploadCatalog: endpoint({
    method: 'POST', path: '/api/v1/catalogs', auth: 'apiKey',
    summary: 'Upload a spreadsheet and audit it in the background',
    multipart: {
      fields: z.object({ clientId: z.string().optional().describe('Default: the organisation\'s default client.') }),
      files: { file: { required: true, maxBytes: LIMITS.uploadBytes, description: 'Excel (.xlsx) or CSV.' } },
    },
    responds: 'json', response: UploadAccepted, status: 202,
    publicApi: {
      success: 202, idempotent: true, paginated: false, successDescription: 'Stored; the audit runs in the background. Poll the report.', successSchema: 'UploadAccepted',
      errors: [...ALWAYS, 'invalid_request', 'idempotency_in_progress', 'idempotency_key_reused', 'not_found', 'plan_expired', 'plan_limit', 'too_large', 'unreadable_file'],
    },
    replaces: ['route:POST /api/v1/catalogs'],
  }),
  report: endpoint({
    method: 'GET', path: '/api/v1/catalogs/{id}/report', auth: 'apiKey',
    summary: 'Status, summary and findings of a catalogue',
    params: z.object({ id: z.string() }),
    query: z.object({ limit: limitParam(PAGE.findings), cursor: cursorParam() }),
    responds: 'json', response: Report,
    publicApi: {
      success: 200, idempotent: false, paginated: true, successDescription: 'Status, summary and one page of findings.', successSchema: 'Report',
      errors: [...ALWAYS, 'invalid_request', 'not_found'],
    },
    replaces: ['route:GET /api/v1/catalogs/[id]/report'],
  }),
  openapi: endpoint({
    method: 'GET', path: '/api/v1/openapi.json', auth: 'public',
    summary: 'This document (OpenAPI 3.0.3)',
    responds: 'json', response: z.record(z.unknown()),
    documented: false,
    replaces: ['route:GET /api/v1/openapi.json'],
  }),
}, { check: 'check', listCatalogs: 'listCatalogs', uploadCatalog: 'uploadCatalog', report: 'report', openapi: 'openapi' });

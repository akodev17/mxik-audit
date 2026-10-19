// OpenAPI 3.0 description of the public API, served at /api/v1/openapi.json. Built from the
// contract (src/lib/api/contract.ts) so every documented status and error code is one a
// handler can return; src/lib/api/openapi.test.ts checks the schemas against the serializers.
import { CatalogStatus, Decision, FindingType, Severity } from '@prisma/client';
import { DECISION_SOURCES } from '../decision-source';
import { ERROR_CODES, ERROR_STATUS, FINDING_FIELDS, HEADERS, IDEMPOTENCY, OPERATIONS, PAGE, type ApiErrorCode, type OperationId } from './contract';
import { apiConfig, type ApiConfig } from './limits';

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const str: Schema = { type: 'string' };
const int: Schema = { type: 'integer' };
const nullable = (schema: Schema): Schema => ({ ...schema, nullable: true });
const object = (properties: Record<string, Schema>, description?: string): Schema => ({
  type: 'object', required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

const SCORE = 'Match score from 0 to 1. It ranks candidates; it is not a probability that the code is right.';
const findingType: Schema = { type: 'string', enum: Object.values(FindingType), description: FINDING_FIELDS.type };
const reason: Schema = { type: 'string', description: FINDING_FIELDS.reason };
const severity: Schema = { type: 'string', enum: Object.values(Severity), description: 'Stable and machine-readable. "info" is shown for information and never counted as risk.' };

const catalogProperties: Record<string, Schema> = {
  id: str,
  filename: str,
  clientId: nullable(str),
  createdAt: { type: 'string', format: 'date-time' },
  status: { type: 'string', enum: Object.values(CatalogStatus) },
  rows: int,
  progress: object({ done: int, total: int }, 'Rows audited so far.'),
};

function schemas(config: ApiConfig): Record<string, Schema> {
  return {
    Error: object({ error: object({ code: { type: 'string', enum: ERROR_CODES }, message: str }) }),
    CheckItem: {
      type: 'object', required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 500 },
        barcode: nullable({ type: 'string', maxLength: 32 }),
        unit: nullable({ type: 'string', maxLength: 60 }),
        mxik: nullable({ type: 'string', maxLength: 32, description: 'The code the product has now, if any.' }),
      },
    },
    CheckRequest: {
      oneOf: [ref('CheckItem'), object({ items: { type: 'array', minItems: 1, maxItems: config.maxCheckItems, items: ref('CheckItem') } })],
    },
    Alternative: object({ code: str, name: str, confidence: { type: 'number', description: SCORE } }),
    CheckFinding: object({
      type: findingType, severity,
      suggestedMxik: nullable({ type: 'string', description: FINDING_FIELDS.suggestedMxik }),
      confidence: nullable({ type: 'number', description: SCORE }),
      reason,
      alternatives: { type: 'array', items: ref('Alternative') },
    }),
    CheckResult: object({ name: str, markingRequired: { type: 'boolean' }, findings: { type: 'array', items: ref('CheckFinding') } }),
    CheckResponse: object({ results: { type: 'array', items: ref('CheckResult') } }),
    Catalog: object(catalogProperties),
    CatalogList: object({ catalogs: { type: 'array', items: ref('Catalog') }, nextCursor: nullable({ type: 'string', description: 'Pass as ?cursor= for the next page; null on the last page.' }) }),
    UploadAccepted: object({ id: str, status: { type: 'string', enum: ['analyzing'] }, rows: int, clientId: str }),
    Finding: object({
      id: str,
      row: { type: 'integer', description: 'Row number in the uploaded file, counting data rows from 1.' },
      name: str,
      barcode: nullable(str),
      unit: nullable(str),
      currentMxik: nullable({ type: 'string', description: 'The code in the uploaded file.' }),
      type: findingType,
      severity,
      suggestedMxik: nullable({ type: 'string', description: `${FINDING_FIELDS.suggestedMxik} It takes effect only when a person accepts it.` }),
      confidence: nullable({ type: 'number', description: SCORE }),
      reason,
      decision: { type: 'string', enum: Object.values(Decision) },
      decisionSource: nullable({ type: 'string', enum: [...DECISION_SOURCES], description: 'How the decision was made: by a person (manual, group, bulk, bulk_sure, dictionary) or automatically (dictionary_auto, carry_over).' }),
      chosenMxik: nullable({ type: 'string', description: 'The code the reviewer chose; may differ from suggestedMxik.' }),
    }),
    Report: object({
      ...catalogProperties,
      error: nullable({ type: 'string', description: 'Set when status is "failed".' }),
      summary: nullable({ type: 'object', additionalProperties: { type: 'integer' }, description: 'Findings per type; null until status is "ready".' }),
      findings: { type: 'array', items: ref('Finding'), description: 'Empty until status is "ready".' },
      nextCursor: nullable({ type: 'string', description: 'Pass as ?cursor= for the next page; null on the last page.' }),
    }),
  };
}

const rateHeaders = {
  [HEADERS.limit]: { $ref: '#/components/headers/RateLimitLimit' },
  [HEADERS.remaining]: { $ref: '#/components/headers/RateLimitRemaining' },
};

function errorResponses(op: OperationId): Record<string, Schema> {
  const byStatus = new Map<number, ApiErrorCode[]>();
  for (const code of OPERATIONS[op].errors) byStatus.set(ERROR_STATUS[code], [...(byStatus.get(ERROR_STATUS[code]) ?? []), code]);
  return Object.fromEntries([...byStatus].map(([status, codes]) => [String(status), {
    description: `Error: ${codes.join(', ')}.`,
    'x-error-codes': codes,
    // Without a valid key there is no key to count requests against.
    ...(status === ERROR_STATUS.unauthorized ? {} : { headers: status === ERROR_STATUS.rate_limited ? { ...rateHeaders, [HEADERS.retryAfter]: { $ref: '#/components/headers/RetryAfter' } } : rateHeaders }),
    content: { 'application/json': { schema: ref('Error') } },
  }]));
}

const SUCCESS: Record<OperationId, { description: string; schema: string }> = {
  check: { description: 'Findings per product, in the order sent.', schema: 'CheckResponse' },
  listCatalogs: { description: 'One page of catalogues, newest first.', schema: 'CatalogList' },
  uploadCatalog: { description: 'Stored; the audit runs in the background. Poll the report.', schema: 'UploadAccepted' },
  report: { description: 'Status, summary and one page of findings.', schema: 'Report' },
};

function responses(op: OperationId): Record<string, Schema> {
  const { success, idempotent } = OPERATIONS[op];
  const headers = idempotent ? { ...rateHeaders, [HEADERS.replayed]: { $ref: '#/components/headers/IdempotentReplayed' } } : rateHeaders;
  return {
    [String(success)]: { description: SUCCESS[op].description, headers, content: { 'application/json': { schema: ref(SUCCESS[op].schema) } } },
    ...errorResponses(op),
  };
}

function pageParams(page: { default: number; max: number }): Schema[] {
  return [
    { name: 'limit', in: 'query', description: `Page size; larger values are cut to ${page.max}.`, schema: { type: 'integer', minimum: 1, maximum: page.max, default: page.default } },
    { name: 'cursor', in: 'query', description: 'nextCursor of the previous page.', schema: str },
  ];
}

const idempotencyParam = { $ref: '#/components/parameters/IdempotencyKey' };

export function openApiSpec(origin: string, config: ApiConfig = apiConfig()) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'MXIK Audit API',
      version: '1.1.0',
      description: [
        'Check product names against the MXIK classifier and audit whole catalogues.',
        'Authenticate with "Authorization: Bearer <key>"; an administrator creates keys in Settings → Integrations.',
        `Each key may send ${config.ratePerMinute} requests per minute; every response to a valid key carries ${HEADERS.limit} and ${HEADERS.remaining}.`,
        'Suggestions are not decisions: a code changes only when a person accepts it in the app.',
      ].join(' '),
    },
    servers: [{ url: origin }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/api/v1/check': {
        post: {
          operationId: 'check',
          summary: `Check one product or up to ${config.maxCheckItems} at once`,
          parameters: [idempotencyParam],
          requestBody: { required: true, content: { 'application/json': { schema: ref('CheckRequest') } } },
          responses: responses('check'),
        },
      },
      '/api/v1/catalogs': {
        get: {
          operationId: 'listCatalogs',
          summary: 'List the catalogues of the key\'s organisation',
          parameters: [...pageParams(PAGE.catalogs), { name: 'clientId', in: 'query', description: 'Only this client\'s catalogues.', schema: str }],
          responses: responses('listCatalogs'),
        },
        post: {
          operationId: 'uploadCatalog',
          summary: 'Upload a spreadsheet and audit it in the background',
          parameters: [idempotencyParam],
          requestBody: {
            required: true,
            content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'Excel (.xlsx) or CSV.' }, clientId: { type: 'string', description: 'Default: the organisation\'s default client.' } } } } },
          },
          responses: responses('uploadCatalog'),
        },
      },
      '/api/v1/catalogs/{id}/report': {
        get: {
          operationId: 'report',
          summary: 'Status, summary and findings of a catalogue',
          parameters: [{ name: 'id', in: 'path', required: true, schema: str }, ...pageParams(PAGE.findings)],
          responses: responses('report'),
        },
      },
    },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      parameters: {
        IdempotencyKey: {
          name: HEADERS.idempotencyKey, in: 'header', required: false,
          description: `1 to ${IDEMPOTENCY.maxLength} visible ASCII characters. Repeating a key with the same API key within ${IDEMPOTENCY.ttlHours} hours returns the first successful response (with ${HEADERS.replayed}: true) instead of running again. Failed requests are not stored. The same key with a different request answers 422 idempotency_key_reused; while the first request still runs, 409 idempotency_in_progress.`,
          schema: { type: 'string', minLength: 1, maxLength: IDEMPOTENCY.maxLength },
        },
      },
      headers: {
        RateLimitLimit: { description: 'Requests this key may send per minute.', schema: int },
        RateLimitRemaining: { description: 'Requests left in the current minute.', schema: int },
        RetryAfter: { description: 'Seconds to wait before the next request.', schema: int },
        IdempotentReplayed: { description: '"true" when this is the stored response of an earlier request with the same Idempotency-Key.', schema: str },
      },
      schemas: schemas(config),
    },
  };
}

// The public API's contract in one place: error codes and their HTTP status, which
// operation may answer which code, header names and paging limits. The handlers,
// the OpenAPI document and the docs page all read it, so they cannot drift apart.

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

export type ErrorBody = { error: { code: ApiErrorCode; message: string } };

type Operation = {
  method: 'get' | 'post';
  path: string;
  success: 200 | 202;
  /** Accepts the Idempotency-Key header. */
  idempotent: boolean;
  /** Pages with limit and cursor. */
  paginated: boolean;
  errors: readonly ApiErrorCode[];
};

/** Every operation can answer these: no key, too many requests, an unexpected failure. */
const ALWAYS = ['unauthorized', 'rate_limited', 'server_error'] as const;

export const OPERATIONS = {
  check: {
    method: 'post', path: '/api/v1/check', success: 200, idempotent: true, paginated: false,
    errors: [...ALWAYS, 'invalid_request', 'idempotency_in_progress', 'idempotency_key_reused', 'plan_expired', 'plan_limit'],
  },
  listCatalogs: {
    method: 'get', path: '/api/v1/catalogs', success: 200, idempotent: false, paginated: true,
    errors: [...ALWAYS, 'invalid_request', 'not_found'],
  },
  uploadCatalog: {
    method: 'post', path: '/api/v1/catalogs', success: 202, idempotent: true, paginated: false,
    errors: [...ALWAYS, 'invalid_request', 'idempotency_in_progress', 'idempotency_key_reused', 'not_found', 'plan_expired', 'plan_limit', 'too_large', 'unreadable_file'],
  },
  report: {
    method: 'get', path: '/api/v1/catalogs/{id}/report', success: 200, idempotent: false, paginated: true,
    errors: [...ALWAYS, 'invalid_request', 'not_found'],
  },
} as const satisfies Record<string, Operation>;

export type OperationId = keyof typeof OPERATIONS;
export type ErrorOf<O extends OperationId> = (typeof OPERATIONS)[O]['errors'][number];

export const OPERATION_IDS = Object.keys(OPERATIONS) as OperationId[];

export const HEADERS = {
  limit: 'X-RateLimit-Limit',
  remaining: 'X-RateLimit-Remaining',
  retryAfter: 'Retry-After',
  idempotencyKey: 'Idempotency-Key',
  replayed: 'Idempotent-Replayed',
} as const;

export const IDEMPOTENCY = { maxLength: 255, ttlHours: 24 } as const;

/** What a finding's fields promise: reason is prose for a person; integrations key on the others. */
export const FINDING_FIELDS = {
  reason: 'Human-readable explanation in Uzbek (Latin script), for a person to read. Its wording may change between releases: do not parse it. Use type, severity and suggestedMxik, the stable machine-readable fields.',
  type: 'Stable machine-readable kind of problem.',
  suggestedMxik: 'Suggested 17-digit code, or null. Stable and machine-readable.',
  restrictedFrom: 'RESTRICTED only (null otherwise): the date (YYYY-MM-DD) from which electronic invoices (EHF) no longer accept the generalized code, per the published list. On a MISSING row the restricted code is the suggested one.',
} as const;

/** Page sizes: a missing or unreadable limit uses the default, a larger one is cut to the maximum. */
export const PAGE = {
  catalogs: { default: 50, max: 100 },
  findings: { default: 200, max: 1000 },
} as const;

/** The limit query parameter, clamped to 1..max. */
export function pageLimit(raw: string | null, page: { default: number; max: number }): number {
  const n = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return page.default;
  return Math.min(page.max, Math.max(1, Math.floor(n)));
}

// One error type for everything the API refuses on purpose. Guards, pipes and services throw it;
// ApiExceptionFilter turns it into the JSON envelope (and the documented /api/v1 codes there).
import { ERROR_STATUS, type ApiErrorCode } from '@tasnivo/domain/api/contract';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    /** Machine-readable, stable: clients branch on it. On /api/v1 it must be an ApiErrorCode. */
    readonly code: string,
    message: string,
    /** Extra response headers (Retry-After, rate-limit headers). */
    readonly headers: Record<string, string> = {},
    /** Extra top-level fields next to `error` (first-party routes only), e.g. `{ unverified: true }`. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** An error with the public API's documented status for its code. */
  static v1(code: ApiErrorCode, message: string, headers: Record<string, string> = {}): ApiError {
    return new ApiError(ERROR_STATUS[code], code, message, headers);
  }
}

/** The code a bare HTTP status gets on first-party routes (Nest's own 404, body-parser's 413…). */
export function codeForStatus(status: number): string {
  switch (status) {
    case 400: return 'invalid_request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 405: return 'method_not_allowed';
    case 409: return 'conflict';
    case 413: return 'too_large';
    case 415: return 'unsupported_media_type';
    case 429: return 'rate_limited';
    case 503: return 'unavailable';
    default: return status >= 500 ? 'server_error' : 'invalid_request';
  }
}

/** The documented /api/v1 code closest to a status, for errors no handler chose a code for. */
export function v1CodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400: return 'invalid_request';
    case 401: return 'unauthorized';
    case 404: return 'not_found';
    case 413: return 'too_large';
    case 429: return 'rate_limited';
    default: return status >= 500 ? 'server_error' : 'invalid_request';
  }
}

// One error type for every failed call: an HTTP error answered with the envelope
// `{ error: { code, message } }`, an older `{ error: "text" }` body, a network failure, or (with
// validation on) a request or answer that does not match its contract.

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    /** HTTP status; 0 when no answer arrived or the request never left. */
    readonly status: number,
    /** Machine-readable: the envelope's code, or `network`, `invalid_request`, `invalid_response`, `http_<status>`. */
    readonly code: string,
    message: string,
    /** The parsed answer body, when there was one. */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Reads an error answer into an ApiError. */
export function errorFrom(status: number, statusText: string, body: unknown): ApiError {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const error = body.error;
    if (typeof error === 'object' && error !== null) {
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (typeof code === 'string') return new ApiError(status, code, typeof message === 'string' ? message : code, body);
    }
    // The Next route handlers answered { error: 'not found' }.
    if (typeof error === 'string') return new ApiError(status, error.replace(/\s+/g, '_'), error, body);
  }
  return new ApiError(status, `http_${status}`, statusText || `HTTP ${status}`, body);
}

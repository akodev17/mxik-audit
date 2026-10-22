// The outcome of a /api/v1 handler before it becomes a response, and the documented error shape.
// Framework-free; the web app's src/lib/api/respond.ts turns outcomes into NextResponses.
import { ERROR_STATUS, HEADERS, type ErrorBody, type ErrorOf, type OperationId } from './contract';
import type { RateResult } from './limits';

/** A response before headers: what a handler decided, and what idempotency stores. */
export type Outcome = { status: number; body: unknown };

/** An error this operation is documented to return. */
export function failure<O extends OperationId>(_op: O, code: ErrorOf<O>, message: string): Outcome {
  const body: ErrorBody = { error: { code, message } };
  return { status: ERROR_STATUS[code], body };
}

export function rateHeaders(rate: RateResult): Record<string, string> {
  return { [HEADERS.limit]: String(rate.limit), [HEADERS.remaining]: String(rate.remaining) };
}

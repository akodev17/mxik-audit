// One error shape and one entry guard for every /api/v1 route. Every response after the key is
// known carries the key's rate-limit headers, success or error.
import { NextResponse } from 'next/server';
import { HEADERS, type OperationId } from '@tasnivo/domain/api/contract';
import { authenticate, type ApiCaller } from '@tasnivo/domain/api/keys';
import { takeRate, type RateResult } from '@tasnivo/domain/api/limits';
import { failure, rateHeaders, type Outcome } from '@tasnivo/domain/api/respond';

export { failure, rateHeaders, type Outcome } from '@tasnivo/domain/api/respond';

export function send(outcome: Outcome, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(outcome.body, { status: outcome.status, headers });
}

export type Entered = {
  caller: ApiCaller;
  rate: RateResult;
  /** Sends an outcome with the rate-limit headers. */
  reply: (outcome: Outcome, extra?: Record<string, string>) => NextResponse;
};

/** Authenticates the key and applies its rate limit; a response means the request stops here. */
export async function enter<O extends OperationId>(op: O, request: Request): Promise<Entered | { response: NextResponse }> {
  const caller = await authenticate(request.headers.get('authorization'));
  if (!caller) {
    return { response: send(failure(op, 'unauthorized', 'Missing or invalid API key. Send the header "Authorization: Bearer <key>".')) };
  }
  const rate = takeRate(caller.keyId);
  if (!rate.ok) {
    const outcome = failure(op, 'rate_limited', `Too many requests: at most ${rate.limit} per minute for this key. Try again in ${rate.retryAfter} s.`);
    return { response: send(outcome, { ...rateHeaders(rate), [HEADERS.retryAfter]: String(rate.retryAfter) }) };
  }
  return { caller, rate, reply: (outcome, extra = {}) => send(outcome, { ...rateHeaders(rate), ...extra }) };
}

/** Logs an unexpected failure and answers with the documented 500 envelope. */
export function crashed<O extends OperationId>(op: O, error: unknown, reply: Entered['reply']): NextResponse {
  console.error(`[api] ${op} failed`, error);
  return reply(failure(op, 'server_error', 'The request could not be completed. Try again later.'));
}

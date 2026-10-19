// One error shape and one entry guard for every /api/v1 route.
import { NextResponse } from 'next/server';
import { authenticate, type ApiCaller } from './keys';
import { takeRate } from './limits';

export type ApiErrorCode = 'unauthorized' | 'rate_limited' | 'invalid_request' | 'not_found' | 'plan_expired' | 'plan_limit' | 'too_large' | 'unreadable_file' | 'server_error';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401, rate_limited: 429, invalid_request: 400, not_found: 404, plan_expired: 402, plan_limit: 402, too_large: 413, unreadable_file: 422, server_error: 500,
};

export function apiError(code: ApiErrorCode, message: string, headers?: Record<string, string>): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: STATUS[code], ...(headers ? { headers } : {}) });
}

/** Authenticates the key and applies its rate limit; a response means the request stops here. */
export async function enter(request: Request): Promise<{ caller: ApiCaller } | { response: NextResponse }> {
  const caller = await authenticate(request.headers.get('authorization'));
  if (!caller) return { response: apiError('unauthorized', 'Missing or invalid API key. Send the header "Authorization: Bearer <key>".') };
  const rate = takeRate(caller.keyId);
  if (!rate.ok) {
    return { response: apiError('rate_limited', 'Too many requests. Try again later.', { 'retry-after': String(rate.retryAfter), 'x-ratelimit-limit': String(rate.limit), 'x-ratelimit-remaining': '0' }) };
  }
  return { caller };
}

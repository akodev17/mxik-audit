import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { HEADERS } from '@tasnivo/domain/api/contract';
import { authenticate } from '@tasnivo/domain/api/keys';
import { rateHeaders } from '@tasnivo/domain/api/respond';
import { ApiError } from '../http/errors';
import { header, type ApiRequest } from '../http/request';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit.store';

export type Authenticate = typeof authenticate;
export const API_KEY_AUTH = Symbol('API_KEY_AUTH');

/**
 * /api/v1 routes: "Authorization: Bearer mxk_…" (a live key of an open account whose creator is
 * still an admin), then the key's per-minute budget. Same errors and headers as the web app's
 * api/respond.ts `enter()`: every response after the key is known carries X-RateLimit-Limit and
 * X-RateLimit-Remaining, success or error. Sets `req.apiCaller` and `req.apiRate`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(API_KEY_AUTH) private readonly authenticate: Authenticate,
    @Inject(RATE_LIMIT_STORE) private readonly rates: RateLimitStore,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const caller = await this.authenticate(header(req, 'authorization'));
    if (!caller) throw ApiError.v1('unauthorized', 'Missing or invalid API key. Send the header "Authorization: Bearer <key>".');
    const rate = await this.rates.take(caller.keyId);
    res.set(rateHeaders(rate));
    if (!rate.ok) {
      throw ApiError.v1('rate_limited', `Too many requests: at most ${rate.limit} per minute for this key. Try again in ${rate.retryAfter} s.`,
        { [HEADERS.retryAfter]: String(rate.retryAfter) });
    }
    req.apiCaller = caller;
    req.apiRate = rate;
    return true;
  }
}

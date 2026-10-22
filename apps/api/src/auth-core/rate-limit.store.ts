import { Injectable } from '@nestjs/common';
import { takeRate, type RateResult } from '@tasnivo/domain/api/limits';

/**
 * Per-key request budget of the public API (API_RATE_PER_MINUTE). Behind an interface so a shared
 * store (Redis INCR/EXPIRE) can replace the per-process one: provide RATE_LIMIT_STORE with
 * `useClass: RedisRateLimitStore` in AuthCoreModule and nothing else changes.
 */
export interface RateLimitStore {
  take(keyId: string): Promise<RateResult>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/** In memory, per process (@tasnivo/domain/api/limits): a restart or a second instance resets the window. */
@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  take(keyId: string): Promise<RateResult> {
    return Promise.resolve(takeRate(keyId));
  }
}

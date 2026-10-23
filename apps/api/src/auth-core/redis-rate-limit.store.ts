// The API keys' per-minute budget in Redis, so every API instance (and a restart) shares one window.
// Same rule and numbers as the in-memory takeRate() of @tasnivo/domain/api/limits: a sliding
// 60-second window of API_RATE_PER_MINUTE requests per key, and on refusal the seconds until the
// oldest request in the window leaves it (at least 1).
import { randomBytes } from 'node:crypto';
import { Logger, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { apiConfig, type RateResult } from '@tasnivo/domain/api/limits';
import { InMemoryRateLimitStore, RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit.store';

const WINDOW_MS = 60_000;

/**
 * One sorted set per key, scored by request time. Atomic: drop what left the window, count, and
 * either refuse (answering the oldest time) or add this request. Returns { allowed, count, oldest }.
 */
const TAKE = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, count, oldest[2] or ARGV[1]}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, count + 1, ARGV[1]}
`;

export type RedisStoreOptions = {
  /** Key prefix; tests use their own. */
  prefix?: string;
  now?: () => number;
  /** API_RATE_PER_MINUTE, read on every request like takeRate() does. */
  limit?: () => number;
};

export class RedisRateLimitStore implements RateLimitStore, OnApplicationShutdown {
  private readonly log = new Logger('RedisRateLimitStore');
  private readonly fallback = new InMemoryRateLimitStore();
  private failing = false;
  private readonly prefix: string;
  private readonly now: () => number;
  private readonly limit: () => number;

  constructor(private readonly redis: Redis, options: RedisStoreOptions = {}) {
    this.prefix = options.prefix ?? 'tasnivo:api-rate:';
    this.now = options.now ?? Date.now;
    this.limit = options.limit ?? (() => apiConfig().ratePerMinute);
  }

  async take(keyId: string): Promise<RateResult> {
    const now = this.now();
    const limit = this.limit();
    let reply: [number, number, string];
    try {
      reply = await this.redis.eval(TAKE, 1, `${this.prefix}${keyId}`, now, WINDOW_MS, limit, `${now}-${randomBytes(6).toString('hex')}`) as [number, number, string];
    } catch (error) {
      // Redis unreachable: keep serving with this process's own window rather than failing every call.
      if (!this.failing) this.log.error(`Redis rate limit unavailable, using the in-memory window: ${error instanceof Error ? error.message : String(error)}`);
      this.failing = true;
      return this.fallback.take(keyId);
    }
    if (this.failing) this.log.log('Redis rate limit available again.');
    this.failing = false;
    const [allowed, count, oldest] = reply;
    if (allowed === 1) return { ok: true, limit, remaining: limit - count, retryAfter: 0 };
    return { ok: false, limit, remaining: 0, retryAfter: Math.max(1, Math.ceil((WINDOW_MS - (now - Number(oldest))) / 1000)) };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}

/**
 * RATE_LIMIT_STORE, provided once by the global AuthCoreModule (Q16): Redis when REDIS_URL is set,
 * otherwise the per-process store. Every module's ApiKeyGuard resolves it from there; no module
 * provides its own.
 */
export function rateLimitStoreProvider(env: Record<string, string | undefined> = process.env): Provider {
  return {
    provide: RATE_LIMIT_STORE,
    useFactory: (): RateLimitStore => {
      const url = env['REDIS_URL']?.trim();
      if (!url) return new InMemoryRateLimitStore();
      const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
      // Connection errors surface in take() (and its fallback); the client keeps reconnecting.
      redis.on('error', () => undefined);
      return new RedisRateLimitStore(redis);
    },
  };
}

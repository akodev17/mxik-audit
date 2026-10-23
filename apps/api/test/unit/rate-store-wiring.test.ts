// Q16: one RATE_LIMIT_STORE for the whole app. AuthCoreModule used to provide an in-memory store
// and ApiKeyGuard, so a module using ApiKeyGuard without PublicApiModule's own Redis provider
// silently counted per process. With REDIS_URL set every store in the app must be the Redis one.
import '../setup-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ModulesContainer } from '@nestjs/core';
import { ApiKeyGuard } from '../../src/auth-core/api-key.guard';
import { InMemoryRateLimitStore, RATE_LIMIT_STORE } from '../../src/auth-core/rate-limit.store';
import { RedisRateLimitStore } from '../../src/auth-core/redis-rate-limit.store';
import { startApp } from '../helpers';

async function storesWith(redisUrl: string | undefined): Promise<{ stores: unknown[]; guardStores: unknown[] }> {
  const saved = process.env['REDIS_URL'];
  if (redisUrl === undefined) delete process.env['REDIS_URL'];
  else process.env['REDIS_URL'] = redisUrl;
  try {
    const app = await startApp();
    try {
      const stores: unknown[] = [];
      const guardStores: unknown[] = [];
      for (const mod of app.get(ModulesContainer).values()) {
        for (const [token, wrapper] of mod.providers) {
          if (token === RATE_LIMIT_STORE && wrapper.instance) stores.push(wrapper.instance);
        }
        for (const wrapper of mod.injectables.values()) {
          if (wrapper.instance instanceof ApiKeyGuard) guardStores.push((wrapper.instance as unknown as { rates: unknown }).rates);
        }
      }
      return { stores, guardStores };
    } finally {
      await app.close();
    }
  } finally {
    if (saved === undefined) delete process.env['REDIS_URL'];
    else process.env['REDIS_URL'] = saved;
  }
}

describe('RATE_LIMIT_STORE wiring (Q16)', () => {
  it('with REDIS_URL, the app has exactly one store and it is Redis; every ApiKeyGuard uses it', async () => {
    // Nothing listens there; the client connects lazily and nothing here takes from the store.
    const { stores, guardStores } = await storesWith('redis://127.0.0.1:1');
    assert.equal(stores.length, 1, 'one provider in the whole app');
    assert.ok(stores[0] instanceof RedisRateLimitStore);
    assert.ok(guardStores.length >= 1, 'the public API guard was found');
    for (const store of guardStores) assert.equal(store, stores[0]);
  });

  it('without REDIS_URL it is the in-memory store', async () => {
    const { stores } = await storesWith(undefined);
    assert.equal(stores.length, 1);
    assert.ok(stores[0] instanceof InMemoryRateLimitStore);
  });
});

// RedisRateLimitStore against a real Redis (REDIS_URL, or a throwaway one on 127.0.0.1:6379; the
// tests skip without one): the same answers as the in-memory takeRate() for the same requests,
// one window shared by two API instances, the in-memory fallback while Redis is down, and the
// /api/v1 routes using it when REDIS_URL is set.
import '../setup-env';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { createApiKey } from '@tasnivo/domain/api/keys';
import { takeRate } from '@tasnivo/domain/api/limits';
import { dropOrgs, makeOrg } from '@tasnivo/domain/test-fixtures';
import { RedisRateLimitStore } from '../../src/auth-core/redis-rate-limit.store';
import { dbSkipReason, serverOf, startApp } from '../helpers';
import { withEnv } from '../w2d-support';

const REDIS_URL = process.env['REDIS_URL']?.trim() || 'redis://127.0.0.1:6379';

async function redisSkipReason(): Promise<string | false> {
  const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 1000, retryStrategy: () => null });
  probe.on('error', () => undefined);
  try {
    await probe.connect();
    await probe.ping();
    return false;
  } catch {
    return `redis not reachable at ${REDIS_URL}`;
  } finally {
    probe.disconnect();
  }
}

const skip = await redisSkipReason();

describe('RedisRateLimitStore', { skip }, () => {
  const clients: Redis[] = [];
  const prefix = `tasnivo-test:${randomBytes(4).toString('hex')}:`;
  const connect = (): Redis => {
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
    clients.push(client);
    return client;
  };

  after(async () => {
    const keys = await clients[0]?.keys(`${prefix}*`) ?? [];
    if (keys.length > 0) await clients[0]?.del(...keys);
    await Promise.all(clients.map((c) => c.quit()));
  });

  it('answers exactly what takeRate() answers for the same requests and clock', async () => {
    let now = 1_000_000;
    const store = new RedisRateLimitStore(connect(), { prefix, now: () => now, limit: () => 3 });
    const memoryKey = `memory-${randomBytes(4).toString('hex')}`;
    const steps = [0, 1_000, 2_000, 3_000, 30_000, 60_001, 61_500, 62_000, 62_001, 125_000];
    for (const at of steps) {
      now = 1_000_000 + at;
      assert.deepEqual(await store.take('key-a'), takeRate(memoryKey, now, 3), `at +${at} ms`);
    }
  });

  it('two instances share one window', async () => {
    const now = Date.now();
    const one = new RedisRateLimitStore(connect(), { prefix, now: () => now, limit: () => 2 });
    const two = new RedisRateLimitStore(connect(), { prefix, now: () => now, limit: () => 2 });
    assert.equal((await one.take('shared')).ok, true);
    assert.equal((await two.take('shared')).ok, true);
    const third = await one.take('shared');
    assert.deepEqual(third, { ok: false, limit: 2, remaining: 0, retryAfter: 60 });
  });

  it('keeps answering from the in-memory window while Redis is unreachable', async () => {
    const down = new Redis('redis://127.0.0.1:1', { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
    down.on('error', () => undefined);
    const store = new RedisRateLimitStore(down, { prefix, limit: () => 60 });
    const result = await store.take(`down-${randomBytes(4).toString('hex')}`);
    assert.equal(result.ok, true);
    assert.equal(result.limit, 60);
    down.disconnect();
  });
});

describe('/api/v1 with REDIS_URL set: the key budget lives in Redis', { skip: skip || await dbSkipReason() }, () => {
  let app: INestApplication;
  let orgId = '';
  let redis: Redis;

  before(async () => {
    app = await withEnv({ REDIS_URL }, () => startApp());
    redis = new Redis(REDIS_URL);
    orgId = (await makeOrg()).orgId;
  });
  after(async () => {
    await app.close();
    await redis.quit();
    await dropOrgs([orgId]);
    await db.$disconnect();
  });

  it('counts each request in the key\'s sorted set and refuses past the limit', async () => {
    const actor = await db.user.findFirstOrThrow({ where: { orgId } });
    const token = (await createApiKey({ orgId, userId: actor.id, role: 'admin' }, 'redis'))?.token ?? '';
    const key = await db.apiKey.findFirstOrThrow({ where: { orgId } });
    await withEnv({ API_RATE_PER_MINUTE: '2' }, async () => {
      const call = () => request(serverOf(app)).get('/api/v1/catalogs').set('Authorization', `Bearer ${token}`);
      assert.equal((await call()).status, 200);
      assert.equal(await redis.zcard(`tasnivo:api-rate:${key.id}`), 1);
      assert.equal((await call()).status, 200);
      const refused = await call();
      assert.equal(refused.status, 429);
      assert.equal(refused.headers['x-ratelimit-limit'], '2');
    });
    await redis.del(`tasnivo:api-rate:${key.id}`);
  });
});

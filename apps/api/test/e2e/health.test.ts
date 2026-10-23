import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@tasnivo/db';
import type { PrismaService } from '../../src/db/prisma.service';
import { HealthController } from '../../src/health/health.controller';
import { bodyOf, dbSkipReason, serverOf, startApp } from '../helpers';

type Health = {
  status: string;
  database: boolean;
  classifier: {
    loaded: boolean; takenAt: string | null; ageDays: number | null; codeCount: number | null; stale: boolean | null;
    lastUpdate: { outcome: string } | null;
  };
};

const skip = await dbSkipReason();

describe('GET /api/health (database)', { skip }, () => {
  let app: INestApplication;
  before(async () => { app = await startApp(); });
  after(async () => {
    await app.close();
    await db.$disconnect();
  });

  it('answers like the web app\'s /api/health: 200 ok with the classifier loaded, 503 otherwise, never cached', async () => {
    const res = await request(serverOf(app)).get('/api/health');
    const body = bodyOf<Health>(res);
    const loaded = (await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM mxik_code WHERE "retiredAt" IS NULL LIMIT 1`).length > 0;
    assert.equal(res.status, loaded ? 200 : 503);
    assert.equal(body.status, loaded ? 'ok' : 'unavailable');
    assert.equal(body.database, true);
    assert.equal(body.classifier.loaded, loaded);
    if (loaded) {
      // The classifier block (moved here from the web app's route test).
      assert.equal(typeof body.classifier.takenAt, 'string');
      assert.ok(Number.isInteger(body.classifier.ageDays) && (body.classifier.ageDays ?? -1) >= 0);
      assert.ok((body.classifier.codeCount ?? 0) > 0);
      assert.equal(typeof body.classifier.stale, 'boolean');
      assert.ok(body.classifier.lastUpdate === null || ['success', 'failed'].includes(body.classifier.lastUpdate.outcome));
    }
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });
});

describe('without a reachable database', () => {
  it('health answers 503 with database false instead of failing', async () => {
    const broken = { client: { $queryRaw: () => Promise.reject(new Error('connect ECONNREFUSED')) } } as unknown as PrismaService;
    let status = 0;
    const body = await new HealthController(broken).health({ status: (s: number) => { status = s; } } as never);
    assert.equal(status, 503);
    assert.equal(body.status, 'unavailable');
    assert.equal(body.database, false);
  });
});

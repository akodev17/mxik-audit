// CronGuard and CsrfGuard through the real app. Neither needs the database (guards answer first).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Controller, HttpCode, Post, UseGuards, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { CronGuard } from '../../src/auth-core/cron.guard';
import { SkipCsrf } from '../../src/http/decorators';
import type { AppConfig } from '../../src/config/env';
import { bodyOf, serverOf, startApp } from '../helpers';

/** Stands in for W2's cron module. */
@Controller('test-cron')
class TestCronController {
  @Post()
  @HttpCode(202)
  @SkipCsrf()
  @UseGuards(CronGuard)
  run() {
    return { started: true };
  }
}

const SECRET = 'e2e-cron-secret-0123456789';
const apps: INestApplication[] = [];
const appWith = async (config: Partial<AppConfig>) => {
  const app = await startApp({ config, controllers: [TestCronController] });
  apps.push(app);
  return serverOf(app);
};

after(async () => {
  await Promise.all(apps.map((a) => a.close()));
  await db.$disconnect();
});

describe('CronGuard (e2e)', () => {
  it('503 while CRON_SECRET is unset', async () => {
    const res = await request(await appWith({ cronSecret: null })).post('/api/test-cron').set('Authorization', `Bearer ${SECRET}`);
    assert.equal(res.status, 503);
    assert.deepEqual(bodyOf(res), { error: { code: 'cron_disabled', message: 'cron disabled' } });
  });

  it('401 for a wrong or missing bearer, 202 for the right one (no CSRF header needed)', async () => {
    const server = await appWith({ cronSecret: SECRET });
    assert.equal((await request(server).post('/api/test-cron')).status, 401);
    const wrong = await request(server).post('/api/test-cron').set('Authorization', 'Bearer e2e-cron-secret-0123456780');
    assert.equal(wrong.status, 401);
    assert.equal(bodyOf(wrong).error.code, 'unauthorized');
    const right = await request(server).post('/api/test-cron').set('Authorization', `Bearer ${SECRET}`);
    assert.equal(right.status, 202);
    assert.deepEqual(bodyOf(right), { started: true });
  });
});

describe('CsrfGuard (e2e)', () => {
  it('a mutating first-party route needs X-Requested-With and the site\'s Origin', async () => {
    const server = await appWith({ siteOrigin: 'https://tasnivo.uz' });
    const body = { email: 'nobody@test.local', password: 'x' };
    const bare = await request(server).post('/api/auth/sign-in').send(body);
    assert.equal(bare.status, 403);
    assert.equal(bodyOf(bare).error.code, 'csrf');
    const foreign = await request(server).post('/api/auth/sign-in').set('X-Requested-With', 'tasnivo').set('Origin', 'https://evil.example').send(body);
    assert.equal(foreign.status, 403);
    assert.equal(bodyOf(foreign).error.code, 'csrf');
  });
});

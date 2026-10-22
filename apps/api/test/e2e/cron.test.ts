// The cron module: CRON_SECRET refusals (503 unset or short, 401 wrong) and, with the worker's
// queues (JOBS_MODE=bullmq, a fake dispatcher here), both jobs are only queued: nothing runs or
// spawns in the API process.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setJobs, type JobDispatcher } from '@tasnivo/domain/jobs/dispatcher';
import { localDay, type DailyJobData } from '@tasnivo/domain/jobs/queues';
import { bodyOf, serverOf, startApp } from '../helpers';

const SECRET = 'cron-secret-for-the-e2e-tests';

describe('cron module', () => {
  let app: INestApplication;
  const queued: { daily: [DailyJobData, string][]; classifier: string[] } = { daily: [], classifier: [] };
  const fake = {
    mode: 'bullmq',
    enqueueDaily: (data: DailyJobData, jobId: string) => { queued.daily.push([data, jobId]); return Promise.resolve(true); },
    enqueueClassifierUpdate: (reason = 'manual') => { queued.classifier.push(reason); return Promise.resolve(); },
  } as unknown as JobDispatcher;

  before(async () => {
    app = await startApp({ config: { cronSecret: SECRET } });
    setJobs(fake);
  });
  after(async () => {
    setJobs(null);
    await app.close();
  });

  for (const path of ['/api/cron/daily', '/api/cron/classifier-update']) {
    it(`${path}: 503 while the secret is unset or short, 401 for a wrong or missing one`, async () => {
      for (const cronSecret of [null, 'too-short']) {
        const off = await startApp({ config: { cronSecret } });
        try {
          const res = await request(serverOf(off)).post(path).set('Authorization', `Bearer ${cronSecret ?? ''}`);
          assert.equal(res.status, 503);
          assert.equal(bodyOf(res).error.code, 'cron_disabled');
        } finally {
          await off.close();
        }
      }
      assert.equal((await request(serverOf(app)).post(path)).status, 401);
      assert.equal((await request(serverOf(app)).post(path).set('Authorization', `Bearer ${SECRET}x`)).status, 401);
    });
  }

  it('POST /api/cron/daily queues today\'s daily job (no CSRF header needed)', async () => {
    const res = await request(serverOf(app)).post('/api/cron/daily').set('Authorization', `Bearer ${SECRET}`);
    assert.equal(res.status, 200);
    const jobId = `daily-${localDay()}`;
    assert.deepEqual(res.body, { queued: true, jobId, added: true });
    assert.deepEqual(queued.daily.at(-1), [{ job: 'daily' }, jobId]);
  });

  it('POST /api/cron/classifier-update queues the update: 202, pid null, the queue as the log', async () => {
    const res = await request(serverOf(app)).post('/api/cron/classifier-update').set('Authorization', `bearer ${SECRET}`);
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { started: true, pid: null, log: 'queue:classifier-update' });
    assert.deepEqual(queued.classifier, ['manual']);
  });
});

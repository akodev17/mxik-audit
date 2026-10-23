// The trial's monthly row allowance through the real app: upload, commit, delete, upload again
// must not pass the cap, on the web wizard's endpoints and on the public API. Regression test for
// the quota rollback (deleting a catalogue used to give its rows back).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { createApiKey } from '@tasnivo/domain/api/keys';
import { defaultClient } from '@tasnivo/domain/clients';
import { setJobs, type JobDispatcher } from '@tasnivo/domain/jobs/dispatcher';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { sessionCookie } from '../upload-fixtures';

const skip = await dbSkipReason();
const { ta } = i18nFor('uz');
const TRIAL_ROWS = 5_000;
const csv = (rows: number, prefix: string): Buffer =>
  Buffer.from(['Nomi;Birlik', ...Array.from({ length: rows }, (_, i) => `${prefix} ${i + 1};dona`)].join('\n'), 'utf8');

type Preview = { ok: true; preview: { catalogId: string; mapping: Record<string, number> } } | { ok: false; error: string };
type Plan = { status: { state: string; usage: { rowsPerMonth: number }; limits: { rowsPerMonth: number | null }; full: string[] } };

describe('trial row allowance: upload → delete → upload (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let owner: TestUser;
  let cookie = '';
  let clientId = '';

  const http = () => request(serverOf(app));
  const post = (path: string) => http().post(path).set('Cookie', cookie).set('X-Requested-With', 'tasnivo');
  const rowsUsed = async (): Promise<number> => {
    const res = await http().get('/api/billing/plan').set('Cookie', cookie);
    assert.equal(res.status, 200);
    return bodyOf<Plan>(res).status.usage.rowsPerMonth;
  };
  const upload = async (rows: number, prefix: string): Promise<Preview> => {
    const res = await post('/api/catalogs/preview').field('clientId', clientId).attach('file', csv(rows, prefix), `${prefix}.csv`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return bodyOf<Preview>(res);
  };
  const commit = async (preview: Preview) => {
    assert.ok(preview.ok, JSON.stringify(preview));
    const res = await post(`/api/catalogs/${preview.preview.catalogId}/commit`).send({ mapping: preview.preview.mapping });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return bodyOf<{ ok: true; catalogId: string } | { ok: false; error: string }>(res);
  };

  before(async () => {
    // Audits are queued, not run in the test process: only the accounting is under test.
    setJobs({ mode: 'bullmq', enqueueAudit: () => Promise.resolve() } as unknown as JobDispatcher);
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    await db.organization.update({ where: { id: owner.orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
    clientId = (await defaultClient(owner.orgId)).id;
    cookie = await sessionCookie(owner);
  });
  after(async () => {
    setJobs(null);
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('the web wizard: deleting a committed catalogue keeps its rows used, so the next upload past the cap is refused', async () => {
    const first = await commit(await upload(3_000, 'A'));
    assert.ok(first.ok);
    assert.equal(await rowsUsed(), 3_000);

    const removed = await http().delete(`/api/catalogs/${first.catalogId}`).set('Cookie', cookie).set('X-Requested-With', 'tasnivo');
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(await rowsUsed(), 3_000, 'deleting does not give the allowance back');

    // Refused at the preview already, in the user's language.
    assert.deepEqual(await upload(3_000, 'B'), { ok: false, error: ta.msg.gate.rowsPerMonth });
    // What still fits is accepted, and then the allowance is full.
    assert.ok((await commit(await upload(TRIAL_ROWS - 3_000, 'C'))).ok);
    assert.equal(await rowsUsed(), TRIAL_ROWS);
    const plan = bodyOf<Plan>(await http().get('/api/billing/plan').set('Cookie', cookie)).status;
    assert.ok(plan.full.includes('rowsPerMonth'));
    assert.deepEqual(await upload(1, 'D'), { ok: false, error: ta.msg.gate.rowsPerMonth });
  });

  it('the public API refuses the same upload with plan_limit, and stores nothing for it', async () => {
    const token = (await createApiKey({ ...owner, role: 'admin' }, 'quota'))?.token ?? '';
    const before = await db.catalog.count({ where: { orgId: owner.orgId } });
    const res = await http().post('/api/v1/catalogs').set('Authorization', `Bearer ${token}`).attach('file', csv(10, 'E'), 'E.csv');
    assert.equal(res.status, 402, JSON.stringify(res.body));
    assert.equal((res.body as { error: { code: string } }).error.code, 'plan_limit');
    assert.equal(await db.catalog.count({ where: { orgId: owner.orgId } }), before);
    assert.equal(await rowsUsed(), TRIAL_ROWS);
  });

  it('a second organisation is not affected by the first one\'s usage', async () => {
    const other = await makeUser();
    orgs.push(other.orgId);
    await db.organization.update({ where: { id: other.orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * 86_400_000) } });
    const res = await http().get('/api/billing/plan').set('Cookie', await sessionCookie(other));
    assert.equal(bodyOf<Plan>(res).status.usage.rowsPerMonth, 0);
  });
});

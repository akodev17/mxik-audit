// The admin module: everyone but a platform admin (signed in or not) gets 404; a platform admin
// gets traction, pipeline status, accuracy in the contract's shape, and the CSV.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { fits, sessionCookie, withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.admin;
const PATHS = ['/api/admin/traction', '/api/admin/pipeline', '/api/admin/accuracy', '/api/admin/metrics'];

describe('admin module (database)', { skip }, () => {
  let app: INestApplication;
  let platform: TestUser;
  let cookie = '';
  let plainCookie = '';
  const orgs: string[] = [];
  const http = () => request(serverOf(app));
  const asAdmin = <T>(run: () => Promise<T>) => withEnv({ ADMIN_EMAILS: platform.email }, run);

  before(async () => {
    app = await startApp();
    platform = await makeUser();
    const plain = await makeUser();
    orgs.push(platform.orgId, plain.orgId);
    await db.user.update({ where: { id: platform.userId }, data: { platformAdmin: true } });
    cookie = await sessionCookie(platform);
    plainCookie = await sessionCookie(plain);
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('404 without a session, for an ordinary admin, and for a flagged user missing from ADMIN_EMAILS', async () => {
    for (const path of PATHS) {
      assert.equal((await http().get(path)).status, 404, path);
      assert.equal((await asAdmin(() => http().get(path).set('Cookie', plainCookie))).status, 404, path);
      assert.equal((await withEnv({ ADMIN_EMAILS: 'someone@else.test' }, () => http().get(path).set('Cookie', cookie))).status, 404, path);
    }
  });

  it('traction, pipeline and accuracy in the contract\'s shape', async () => {
    fits(e.traction.response, (await asAdmin(() => http().get('/api/admin/traction').set('Cookie', cookie))).body);
    const pipeline = fits(e.pipeline.response, (await asAdmin(() => http().get('/api/admin/pipeline').set('Cookie', `${cookie}; mxik_locale=ru`))).body);
    assert.equal(pipeline.length, 4);
    const accuracy = fits(e.accuracy.response, (await asAdmin(() => http().get('/api/admin/accuracy?by=label').set('Cookie', cookie))).body);
    assert.equal(accuracy.overall.key, 'total');
    assert.equal((await asAdmin(() => http().get('/api/admin/accuracy?by=nope').set('Cookie', cookie))).status, 400);
  });

  it('GET /api/admin/metrics: CSV per dimension or reasons; an unknown one is 400', async () => {
    const csv = await asAdmin(() => http().get('/api/admin/metrics?by=week').set('Cookie', cookie));
    assert.equal(csv.status, 200);
    assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(csv.headers['content-disposition'], 'attachment; filename="accuracy-week.csv"');
    assert.match(csv.text, /^week,week_name,accepted_unchanged,replaced,rejected,open,accept_rate\n/);
    const stage = await asAdmin(() => http().get('/api/admin/metrics').set('Cookie', cookie));
    assert.match(stage.text, /^stage,/);
    assert.match((await asAdmin(() => http().get('/api/admin/metrics?by=reasons').set('Cookie', cookie))).text, /^reason,reason_name,/);
    assert.equal((await asAdmin(() => http().get('/api/admin/metrics?by=nope').set('Cookie', cookie))).status, 400);
  });
});

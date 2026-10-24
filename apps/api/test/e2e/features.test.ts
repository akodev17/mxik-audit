// Module flags: GET /api/modules for everyone, GET/PUT /api/admin/features for a platform admin only
// (404 to anyone else, as the other admin routes). Writes ENABLED rows only, which change nothing for
// the tests running beside this one; the guard's 404s are in unit/module-guard.test.ts and the whole
// flow in apps/web/e2e/module-flags.e2e.ts.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { allEnabled, MODULE_KEYS } from '@tasnivo/contracts/feature-modules';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { CSRF, fits, sessionCookie, withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.admin;

describe('module flags (database)', { skip }, () => {
  let app: INestApplication;
  let platform: TestUser;
  let plain: TestUser;
  let cookie = '';
  let plainCookie = '';
  const orgs: string[] = [];
  const http = () => request(serverOf(app));
  const asAdmin = <T>(run: () => Promise<T>) => withEnv({ ADMIN_EMAILS: platform.email }, run);
  const put = (c: string, body: unknown) => http().put('/api/admin/features').set(CSRF).set('Cookie', c).send(body as object);
  let saved: { key: string; state: 'ENABLED' | 'COMING_SOON' | 'HIDDEN' }[] = [];

  before(async () => {
    saved = await db.featureFlag.findMany({ select: { key: true, state: true } });
    app = await startApp();
    platform = await makeUser();
    plain = await makeUser();
    orgs.push(platform.orgId, plain.orgId);
    await db.user.update({ where: { id: platform.userId }, data: { platformAdmin: true } });
    cookie = await sessionCookie(platform);
    plainCookie = await sessionCookie(plain);
  });
  after(async () => {
    // Back to the rows the database had before this file ran.
    await db.featureFlag.deleteMany({ where: { key: { notIn: saved.map((r) => r.key) } } });
    for (const row of saved) await db.featureFlag.update({ where: { key: row.key }, data: { state: row.state } });
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('GET /api/modules: every registry module, without a session', async () => {
    const res = await http().get('/api/modules');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(fits(endpoints.account.modules.response, res.body)), [...MODULE_KEYS]);
  });

  it('404 without a session, for an ordinary user listed in ADMIN_EMAILS, and for a flagged user missing from it', async () => {
    assert.equal((await http().get('/api/admin/features')).status, 404);
    assert.equal((await http().put('/api/admin/features').set(CSRF).send({ states: {} })).status, 404);
    await withEnv({ ADMIN_EMAILS: plain.email }, async () => {
      assert.equal((await http().get('/api/admin/features').set('Cookie', cookie)).status, 404);
      assert.equal((await put(cookie, { states: { didox: 'ENABLED' } })).status, 404);
    });
    await withEnv({ ADMIN_EMAILS: `${platform.email},${plain.email}` }, async () => {
      assert.equal((await http().get('/api/admin/features').set('Cookie', plainCookie)).status, 404);
      assert.equal((await put(plainCookie, { states: { didox: 'ENABLED' } })).status, 404);
    });
  });

  it('a platform admin reads every module, saves states, and GET /api/modules answers the save at once', async () => {
    const rows = fits(e.features.response, (await asAdmin(() => http().get('/api/admin/features').set('Cookie', cookie))).body);
    assert.deepEqual(rows.map((r) => r.key), [...MODULE_KEYS]);

    const before = Date.now();
    const res = await asAdmin(() => put(cookie, { states: allEnabled() }));
    assert.deepEqual([res.status, res.body], [200, { ok: true }]);
    const after = fits(e.features.response, (await asAdmin(() => http().get('/api/admin/features').set('Cookie', cookie))).body);
    for (const row of after) {
      assert.equal(row.state, 'ENABLED', row.key);
      assert.ok(row.updatedAt && Date.parse(row.updatedAt) >= before - 1000, row.key);
    }
    assert.deepEqual((await http().get('/api/modules')).body, allEnabled());
  });

  it('refuses an unknown module, an unknown state and a missing CSRF header', async () => {
    assert.equal((await asAdmin(() => put(cookie, { states: { nope: 'ENABLED' } }))).status, 400);
    assert.equal((await asAdmin(() => put(cookie, { states: { didox: 'OFF' } }))).status, 400);
    assert.equal((await asAdmin(() => put(cookie, {}))).status, 400);
    const noCsrf = await asAdmin(() => http().put('/api/admin/features').set('Cookie', cookie).send({ states: { didox: 'ENABLED' } }));
    assert.equal(noCsrf.status, 403);
  });
});

// Q4: a new org can upload through the wizard API before any page was opened, and GET /api/shell
// writes nothing. Before the fix the default client was created only as a side effect of the shell
// GET, so an API-driven org's admin got "Bu mijozga yuklash huquqingiz yoʻq." from the preview.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { db } from '@tasnivo/db';
import { issueCode } from '@tasnivo/domain/security/email-code';
import { bodyOf, dbSkipReason, startApp, testIp } from '../helpers';
import { client, Fixtures, quietEnv, sessionCookie, sessionPair } from '../session-helpers';

const skip = await dbSkipReason();
const CSV = Buffer.from('Nomi;Birlik\nNon;dona\nSut;l\n');

type Preview = { ok: boolean; error?: string; preview?: { client: { id: string } } };

describe('default client from the start (Q4, database)', { skip }, () => {
  let app: INestApplication;
  let call: ReturnType<typeof client>;
  const fx = new Fixtures();
  const restoreEnv = quietEnv();
  const preview = (cookie: string) => call(cookie).post('/api/catalogs/preview').attach('file', CSV, 'katalog.csv');

  before(async () => {
    app = await startApp();
    call = client(app);
  });
  after(async () => {
    await app.close();
    await fx.drop();
    restoreEnv();
    await db.$disconnect();
  });

  it('sign-up creates the default client with the org; the confirmed admin previews an upload with no GET first', async () => {
    const email = `noclient-${testIp()}@example.com`.toLowerCase();
    const signed = await call().post('/api/auth/sign-up').send({ email, password: 'long-enough-1', firm: 'API firma' });
    await fx.adopt(email);
    const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true, orgId: true } });
    const clients = await db.client.findMany({ where: { orgId: user.orgId }, select: { name: true, isDefault: true } });
    assert.deepEqual(clients, [{ name: 'API firma', isDefault: true }]);

    const confirmed = await call(sessionPair(signed)).post('/api/auth/verify-code').send({ code: await issueCode(user.id) });
    const cookie = sessionPair(confirmed) ?? '';
    const res = bodyOf<Preview>(await preview(cookie));
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  it('an older org without any client: the admin\'s preview creates the default client instead of "no right"', async () => {
    const u = await fx.user();
    assert.equal(await db.client.count({ where: { orgId: u.orgId } }), 0);
    const res = bodyOf<Preview>(await preview(await sessionCookie(u)));
    assert.equal(res.ok, true, JSON.stringify(res));
    const made = await db.client.findFirstOrThrow({ where: { orgId: u.orgId }, select: { id: true, isDefault: true } });
    assert.equal(made.isDefault, true);
    assert.equal(res.preview?.client.id, made.id);
  });

  it('GET /api/shell writes nothing (Q15): an org without a client still has none afterwards', async () => {
    const u = await fx.user();
    const frame = await call(await sessionCookie(u)).get('/api/shell');
    assert.equal(frame.status, 200);
    assert.deepEqual(bodyOf<{ clients: unknown[]; activeClient: unknown }>(frame).clients, []);
    assert.equal(bodyOf<{ activeClient: unknown }>(frame).activeClient, null);
    assert.equal(await db.client.count({ where: { orgId: u.orgId } }), 0);
  });
});

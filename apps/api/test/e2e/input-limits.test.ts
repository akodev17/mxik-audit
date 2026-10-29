// S6 (F13, F20) through the real app against the development database: body caps answer 413 in
// the API's error shape (the lead form, /api/v1 uploads, Payme with a non-JSON body), the lead
// form's address limit is spent before its body is read, and spreadsheet uploads beyond an org's
// two slots (or the process's eight) answer 429 with Retry-After.
import '../setup-env';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LIMITS } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { createApiKey } from '@tasnivo/domain/api/keys';
import { makeClient } from '@tasnivo/domain/firm-test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { MULTIPART_ALLOWANCE, PAYMENT_CALLBACK_CAP } from '../../src/http/request-body';
import { UPLOAD_SLOTS, uploadSlots } from '../../src/http/upload-slots';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, testIp, type TestUser } from '../helpers';
import { sessionCookie, xlsx } from '../upload-fixtures';
import { withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const CSRF = { 'X-Requested-With': 'tasnivo' } as const;
const { ta } = i18nFor('uz');

describe('input limits: body caps, lead limit order, upload slots (database)', { skip }, () => {
  let app: INestApplication;
  let owner: TestUser;
  let cookie = '';
  let clientId = '';
  let token = '';
  let file: Buffer;
  const orgs: string[] = [];
  const contacts: string[] = [];
  const http = () => request(serverOf(app));

  before(async () => {
    app = await startApp();
    owner = await makeUser();
    orgs.push(owner.orgId);
    await db.organization.update({ where: { id: owner.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * 86_400_000) } });
    clientId = await makeClient(owner.orgId, 'Limit mijoz');
    cookie = await sessionCookie(owner);
    token = (await createApiKey({ orgId: owner.orgId, userId: owner.userId, role: 'admin' }, 'limits'))?.token ?? '';
    file = await xlsx([['Nomi', 'Birlik'], ['Guruch', 'kg']]);
  });
  after(async () => {
    await db.lead.deleteMany({ where: { contact: { in: contacts } } });
    await app.close();
    await dropOrgs(orgs);
  });

  it('POST /api/lead past its cap (5 MB file + the form) is a 413 in the error shape, in the reader\'s language', async () => {
    const res = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', '@toolong')
      .attach('file', Buffer.alloc(LIMITS.leadBytes + MULTIPART_ALLOWANCE + 1, 65), 'katta.csv');
    assert.equal(res.status, 413);
    assert.deepEqual(bodyOf(res), { error: { code: 'too_large', message: ta.httpX.tooLarge } });
  });

  it('POST /api/lead spends the address limit before reading the body: a refused sender gets the limit, not a 413', async () => {
    const ip = testIp();
    for (let i = 0; i < 5; i++) await http().post('/api/lead').set(CSRF).set('X-Real-IP', ip).field('contact', '1');
    const sixth = await http().post('/api/lead').set(CSRF).set('X-Real-IP', ip).field('contact', '@late')
      .attach('file', Buffer.alloc(LIMITS.leadBytes + MULTIPART_ALLOWANCE + 1, 65), 'katta.csv');
    assert.equal(sixth.status, 200);
    assert.match(bodyOf<{ error?: string }>(sixth).error ?? '', /^Soʻrovlar juda koʻp\. \d+ daqiqadan keyin/);
    // Within the cap the form is read as before.
    const handle = `@lead${randomBytes(4).toString('hex')}`;
    contacts.push(handle);
    const ok = await http().post('/api/lead').set(CSRF).set('X-Real-IP', testIp()).field('contact', handle).attach('file', Buffer.from('Nomi;Birlik\nGuruch;kg\n'), 'namuna.csv');
    assert.deepEqual(ok.body, { ok: true });
  });

  it('POST /api/v1/catalogs past 20 MB + the form is a 413 in the v1 envelope', async () => {
    const res = await http().post('/api/v1/catalogs').set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.alloc(LIMITS.uploadBytes + MULTIPART_ALLOWANCE + 1, 65), 'katta.csv');
    assert.equal(res.status, 413);
    assert.deepEqual(bodyOf(res), { error: { code: 'too_large', message: 'The request body is too large.' } });
  });

  it('a Payme callback that is not JSON is read to 64 KB at most (413 past it)', async () => {
    await withEnv({ PAYME_MERCHANT_ID: 'payme-merchant', PAYME_KEY: 'payme-test-key', PAYME_TEST_MODE: undefined }, async () => {
      const big = await http().post('/api/payments/payme').set('Content-Type', 'text/plain').send('x'.repeat(PAYMENT_CALLBACK_CAP + 1));
      assert.equal(big.status, 413);
      assert.equal(bodyOf(big).error.code, 'too_large');
      // Under the cap a body that is not JSON is still Payme's own parse error, as before.
      const small = await http().post('/api/payments/payme').set('Content-Type', 'text/plain').send('not json');
      assert.equal(small.status, 200);
    });
  });

  it('a module path in another letter case reaches the same route and gets the same module answer (F20)', async () => {
    const lower = await http().get('/api/didox/invoices').set('Cookie', cookie);
    const upper = await http().get('/API/DIDOX/invoices').set('Cookie', cookie);
    // Express routes case-insensitively, so the module guard must too: whatever the flag, one answer.
    assert.equal(upper.status, lower.status);
    assert.notEqual(upper.status, 500);
  });

  it(`uploads beyond ${UPLOAD_SLOTS.perOrg} at once per org answer 429 with Retry-After; a freed slot lets the next one in`, async () => {
    const upload = () => http().post('/api/catalogs/preview').set('Cookie', cookie).set(CSRF).field('clientId', clientId).attach('file', file, 'k.xlsx');
    const held = [uploadSlots.take(`org:${owner.orgId}`), uploadSlots.take(`org:${owner.orgId}`)];
    try {
      const busy = await upload();
      assert.equal(busy.status, 429);
      assert.equal(busy.headers['retry-after'], String(UPLOAD_SLOTS.retryAfterSeconds));
      assert.deepEqual(bodyOf(busy), { error: { code: 'rate_limited', message: ta.httpX.uploadBusy } });
      const v1 = await http().post('/api/v1/catalogs').set('Authorization', `Bearer ${token}`).attach('file', file, 'k.xlsx');
      assert.equal(v1.status, 429);
      assert.equal(bodyOf(v1).error.code, 'rate_limited');
    } finally {
      for (const release of held) release?.();
    }
    const before = uploadSlots.inUse;
    const ok = await upload();
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(uploadSlots.inUse, before, 'the upload gave its slot back');
  });

  it(`the process takes ${UPLOAD_SLOTS.perProcess} uploads at once, whichever orgs they come from; a refused large upload still gets the 429`, async () => {
    const held = Array.from({ length: UPLOAD_SLOTS.perProcess }, (_, i) => uploadSlots.take(`org:other-${i}`));
    try {
      assert.ok(held.every(Boolean));
      // A large body still gets its answer: the refused upload is read to its end and dropped, not reset.
      const busy = await http().post('/api/catalogs/preview').set('Cookie', cookie).set(CSRF).field('clientId', clientId).attach('file', Buffer.alloc(3 * 1024 * 1024, 65), 'k.csv');
      assert.equal(busy.status, 429);
    } finally {
      for (const release of held) release?.();
    }
  });
});

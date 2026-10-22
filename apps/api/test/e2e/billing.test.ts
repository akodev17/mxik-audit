// The billing module against the development database: plan and purchase reads in the contract's
// shape, checkout (a provider's payment page when one is configured, the action's refusals
// otherwise), and the Click and Payme callbacks with their own checks instead of a session or CSRF.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { CLICK_ERRORS, clickSign } from '@tasnivo/domain/billing/click';
import { PAYME_ERRORS } from '@tasnivo/domain/billing/payme';
import { makeCatalog } from '@tasnivo/domain/test-fixtures';
import { i18nFor } from '@tasnivo/i18n/locale';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { addMember, CSRF, fits, sessionCookie, withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.billing;
const { t, ta } = i18nFor('uz');
type ClickReply = Record<string, string | number>;

const NO_PROVIDERS = { CLICK_SERVICE_ID: undefined, CLICK_MERCHANT_ID: undefined, CLICK_SECRET_KEY: undefined, PAYME_MERCHANT_ID: undefined, PAYME_KEY: undefined, PAYME_TEST_MODE: undefined };
const CLICK = { ...NO_PROVIDERS, CLICK_SERVICE_ID: '777', CLICK_MERCHANT_ID: '888', CLICK_SECRET_KEY: 'click-test-secret' };
const PAYME = { ...NO_PROVIDERS, PAYME_MERCHANT_ID: 'payme-merchant', PAYME_KEY: 'payme-test-key' };

describe('billing module (database)', { skip }, () => {
  let app: INestApplication;
  let admin: TestUser;
  let adminCookie = '';
  let catalogId = '';
  const orgs: string[] = [];
  const http = () => request(serverOf(app));

  before(async () => {
    app = await startApp();
    admin = await makeUser();
    orgs.push(admin.orgId);
    adminCookie = await sessionCookie(admin);
    catalogId = (await makeCatalog(admin.orgId, [{ rawName: 'Guruch', suggestedMxik: null, confidence: null }])).catalogId;
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('GET /api/billing/plan answers the plan in the contract\'s shape', async () => {
    const res = await http().get('/api/billing/plan').set('Cookie', adminCookie);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const plan = fits(e.plan.response, res.body);
    assert.equal(plan.trialDays, 14);
    assert.equal(plan.status.state, 'expired');
  });

  it('GET /api/catalogs/{id}/purchase: the catalogue\'s tier; another org\'s catalogue is 404', async () => {
    const res = await withEnv(CLICK, () => http().get(`/api/catalogs/${catalogId}/purchase`).set('Cookie', adminCookie));
    const purchase = fits(e.catalogPurchase.response, res.body);
    assert.equal(purchase.planId, 'catalog_500');
    assert.deepEqual(purchase.purchase, { kind: 'available', price: 700_000, providers: ['click'] });
    const stranger = await makeUser();
    orgs.push(stranger.orgId);
    assert.equal((await http().get(`/api/catalogs/${catalogId}/purchase`).set('Cookie', await sessionCookie(stranger))).status, 404);
  });

  it('checkout: a payment page when Click is configured, the action\'s refusals otherwise', async () => {
    const body = { planId: 'catalog_500', catalogId, provider: 'click' };
    const res = await withEnv(CLICK, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', adminCookie).send(body));
    assert.equal(res.status, 200);
    const answer = fits(e.checkout.response, res.body);
    assert.ok(answer.ok, JSON.stringify(answer));
    const url = new URL(answer.url);
    assert.equal(url.origin, 'https://my.click.uz');
    assert.equal(url.searchParams.get('service_id'), '777');
    const order = await db.order.findUniqueOrThrow({ where: { id: url.searchParams.get('transaction_param') ?? '' } });
    assert.equal(order.amount, 700_000);

    const none = await withEnv(NO_PROVIDERS, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', adminCookie).send(body));
    assert.deepEqual(none.body, { ok: false, error: ta.setX.plan.why.no_provider });
    const writer = await addMember(admin.orgId, 'accountant');
    assert.equal((await http().post('/api/billing/checkout').set(CSRF).send(body)).status, 401);
    const byWriter = await withEnv(CLICK, async () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', await sessionCookie(writer)).send(body));
    assert.deepEqual(byWriter.body, { ok: false, error: ta.setX.plan.why.admin_only });
    const bad = await withEnv(CLICK, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', adminCookie).send({ planId: 'catalog_500' }));
    assert.deepEqual(bad.body, { ok: false, error: t.errorGeneric });
  });

  it('the callbacks are 404 while their provider is not configured', async () => {
    await withEnv(NO_PROVIDERS, async () => {
      const click = await http().post('/api/payments/click').type('form').send({ action: '0' });
      assert.equal(click.status, 404);
      const payme = await http().post('/api/payments/payme').send({ id: 1, method: 'CheckPerformTransaction', params: {} });
      assert.equal(payme.status, 404);
    });
  });

  it('Click: a bad signature is refused; a signed Prepare for a real order is accepted (no session, no CSRF header)', async () => {
    const order = await db.order.create({ data: { orgId: admin.orgId, planId: 'catalog_500', catalogId, amount: 700_000, provider: 'click' } });
    const fields = {
      click_trans_id: `${Date.now()}`, service_id: '777', click_paydoc_id: '1', merchant_trans_id: order.id,
      amount: '700000', action: '0', error: '0', error_note: 'Success', sign_time: '2026-10-23 10:00:00',
    };
    await withEnv(CLICK, async () => {
      const forged = await http().post('/api/payments/click').type('form').send({ ...fields, sign_string: 'deadbeef' });
      assert.equal(forged.status, 200);
      assert.equal(bodyOf<ClickReply>(forged).error, CLICK_ERRORS.sign.error);
      const signed = await http().post('/api/payments/click').type('form').send({ ...fields, sign_string: clickSign(fields, 'click-test-secret') });
      assert.equal(signed.status, 200);
      const reply = bodyOf<ClickReply>(signed);
      assert.equal(reply.error, 0, JSON.stringify(reply));
      assert.equal(typeof reply['merchant_prepare_id'], 'number');
    });
  });

  it('Payme: wrong credentials and an unreadable body are JSON-RPC errors with HTTP 200', async () => {
    await withEnv(PAYME, async () => {
      const call = { jsonrpc: '2.0', id: 7, method: 'CheckPerformTransaction', params: {} };
      const wrong = await http().post('/api/payments/payme').set('Authorization', `Basic ${Buffer.from('Paycom:wrong').toString('base64')}`).send(call);
      assert.equal(wrong.status, 200);
      assert.deepEqual(wrong.body, { jsonrpc: '2.0', id: 7, error: PAYME_ERRORS.auth });
      const unreadable = await http().post('/api/payments/payme').set('Content-Type', 'text/plain').send('{not json');
      assert.deepEqual(unreadable.body, { jsonrpc: '2.0', id: null, error: PAYME_ERRORS.parse });
      const auth = `Basic ${Buffer.from('Paycom:payme-test-key').toString('base64')}`;
      const unknown = await http().post('/api/payments/payme').set('Authorization', auth).send({ ...call, method: 'NoSuchMethod' });
      assert.deepEqual(unknown.body, { jsonrpc: '2.0', id: 7, error: PAYME_ERRORS.method });
    });
  });
});

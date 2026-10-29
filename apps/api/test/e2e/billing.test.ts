// The billing module against the development database: plan and purchase reads in the contract's
// shape, checkout (a provider's payment page when one is configured, the action's refusals
// otherwise), and the Click and Payme callbacks with their own checks instead of a session or CSRF:
// Click Prepare/Complete, Payme Create/Perform/Cancel/Check/GetStatement with retries, races and the
// 12-hour timeout; the tier rule at checkout; and uploads refused once the plan has ended.
import '../setup-env';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { CLICK_ERRORS, clickSign } from '@tasnivo/domain/billing/click';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { recordTransfer } from '@tasnivo/domain/billing/orders';
import { addMonths } from '@tasnivo/domain/billing/period';
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
  /** Orders whose org a test deleted: they outlive it by design, so they are removed here. */
  const orphanOrders: string[] = [];
  const http = () => request(serverOf(app));
  const freshOrg = async () => {
    const u = await makeUser();
    orgs.push(u.orgId);
    return u;
  };
  const subscriptionOrder = (orgId: string, planId = 'company_monthly', amount = 390_000) =>
    db.order.create({ data: { orgId, planId, amount, provider: 'click' } });
  const until = async (orgId: string) => (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).subscriptionUntil;

  // Click: every call signed with the test secret; `action` 0 = Prepare, 1 = Complete.
  const click = (fields: Record<string, string>) =>
    withEnv(CLICK, () => http().post('/api/payments/click').type('form').send({ ...fields, sign_string: clickSign(fields, 'click-test-secret') }));
  const clickFields = (orderId: string, transId: string, amount: string, action: '0' | '1', extra: Record<string, string> = {}) => ({
    click_trans_id: transId, service_id: '777', click_paydoc_id: '1', merchant_trans_id: orderId,
    amount, action, error: '0', error_note: 'Success', sign_time: '2026-10-29 10:00:00', ...extra,
  });

  // Payme: JSON-RPC with the merchant's Basic auth.
  const PAYME_AUTH = `Basic ${Buffer.from('Paycom:payme-test-key').toString('base64')}`;
  const payme = async (method: string, params: Record<string, unknown>, env: Record<string, string | undefined> = PAYME, auth = PAYME_AUTH) =>
    bodyOf<{ result?: Record<string, unknown>; error?: { code: number } }>(
      await withEnv(env, () => http().post('/api/payments/payme').set('Authorization', auth).send({ jsonrpc: '2.0', id: 1, method, params })),
    );
  const paymeId = () => `pm-${randomBytes(6).toString('hex')}`;

  before(async () => {
    app = await startApp();
    admin = await makeUser();
    orgs.push(admin.orgId);
    adminCookie = await sessionCookie(admin);
    catalogId = (await makeCatalog(admin.orgId, [{ rawName: 'Guruch', suggestedMxik: null, confidence: null }])).catalogId;
  });
  after(async () => {
    await app.close();
    await db.order.deleteMany({ where: { id: { in: orphanOrders } } });
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
    assert.equal(purchase.maxRows, 500);
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

  it('subscriptions: the plan lists every tier, and a yearly checkout orders ten months\' price for no catalogue', async () => {
    const plan = fits(e.plan.response, (await http().get('/api/billing/plan').set('Cookie', adminCookie)).body);
    assert.deepEqual(plan.tiers.map((t) => [t.monthly.id, t.yearly.id]), [
      ['company_monthly', 'company_yearly'], ['accountant_monthly', 'accountant_yearly'], ['firm_monthly', 'firm_yearly'],
    ]);
    for (const t of plan.tiers) assert.equal(t.yearly.price, t.monthly.price * 10);
    assert.equal(plan.status.tier, null);

    const yearly = plan.tiers[0]?.yearly;
    assert.ok(yearly);
    const res = await withEnv(CLICK, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', adminCookie).send({ planId: yearly.id, catalogId: null, provider: 'click' }));
    const answer = fits(e.checkout.response, res.body);
    assert.ok(answer.ok, JSON.stringify(answer));
    const order = await db.order.findUniqueOrThrow({ where: { id: new URL(answer.url).searchParams.get('transaction_param') ?? '' } });
    assert.deepEqual([order.planId, order.amount, order.catalogId], [yearly.id, yearly.price, null]);
    // The id the single firm subscription had still checks out, at the top tier's monthly price.
    const legacy = await withEnv(CLICK, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', adminCookie).send({ planId: 'firm_monthly', catalogId: null, provider: 'click' }));
    assert.ok(fits(e.checkout.response, legacy.body).ok);
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

  it('Click Complete: pays once and extends one month; a retried Complete and a later Prepare answer "already paid"', async () => {
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const transId = `${Date.now()}1`;
    const prepared = bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '0')));
    assert.equal(prepared.error, 0, JSON.stringify(prepared));
    const prepareId = String(prepared['merchant_prepare_id']);
    const done = bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '1', { merchant_prepare_id: prepareId })));
    assert.equal(done.error, 0, JSON.stringify(done));
    assert.equal(String(done['merchant_confirm_id']), prepareId);
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { transactions: true } });
    assert.deepEqual([paid.status, paid.provider, paid.transactions[0]?.state], ['paid', 'click', 2]);
    assert.deepEqual(await until(orgId), addMonths(paid.paidAt ?? new Date(), 1));

    const retry = bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '1', { merchant_prepare_id: prepareId })));
    assert.equal(retry.error, CLICK_ERRORS.paid.error);
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '0'))).error, CLICK_ERRORS.paid.error);
    assert.deepEqual(await until(orgId), addMonths(paid.paidAt ?? new Date(), 1), 'still one month');
  });

  it('Click Complete with error < 0 cancels the order; a Prepare for it is not reopened', async () => {
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const transId = `${Date.now()}2`;
    const prepareId = String(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '0')))['merchant_prepare_id']);
    const failed = bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '1', { merchant_prepare_id: prepareId, error: '-5017', error_note: 'Insufficient funds' })));
    assert.equal(failed.error, CLICK_ERRORS.cancelled.error);
    const cancelled = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { transactions: true } });
    assert.deepEqual([cancelled.status, cancelled.transactions[0]?.state], ['cancelled', -1]);
    assert.equal(await until(orgId), null);
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '0'))).error, CLICK_ERRORS.cancelled.error);
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '1', { merchant_prepare_id: prepareId }))).error, CLICK_ERRORS.cancelled.error);
  });

  it('Click: a wrong amount is -2; a missing or malformed merchant_prepare_id is -8 (never a 500); an unknown one is -6', async () => {
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const transId = `${Date.now()}3`;
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '1000', '0'))).error, CLICK_ERRORS.amount.error);
    const prepareId = String(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '0')))['merchant_prepare_id']);
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '1000', '1', { merchant_prepare_id: prepareId }))).error, CLICK_ERRORS.amount.error);
    for (const bad of [undefined, 'abc', '1.5', '99999999999', '-1']) {
      const res = await click(clickFields(order.id, transId, '390000', '1', bad === undefined ? {} : { merchant_prepare_id: bad }));
      assert.equal(res.status, 200, String(bad));
      assert.equal(bodyOf<ClickReply>(res).error, CLICK_ERRORS.request.error, String(bad));
    }
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, transId, '390000', '1', { merchant_prepare_id: '2147483647' }))).error, CLICK_ERRORS.transaction.error);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'created');
  });

  it('Click Prepare refuses a cheaper tier while a dearer subscription runs (before any money moves)', async () => {
    const { orgId } = await freshOrg();
    assert.ok((await recordTransfer({ orgId, planId: 'firm_monthly', catalogId: null })).ok);
    const order = await subscriptionOrder(orgId);
    assert.equal(bodyOf<ClickReply>(await click(clickFields(order.id, `${Date.now()}4`, '390000', '0'))).error, CLICK_ERRORS.cancelled.error);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'cancelled');
  });

  it('Payme: CheckPerform, Create (one open transaction per order), Perform (once, also when sent twice at once), Check, Cancel refused after Perform', async () => {
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const account = { order_id: order.id };
    assert.deepEqual((await payme('CheckPerformTransaction', { account, amount: 39_000_000 })).result, { allow: true });
    assert.equal((await payme('CheckPerformTransaction', { account, amount: 100 })).error?.code, PAYME_ERRORS.amount.code);
    assert.equal((await payme('CheckPerformTransaction', { account: { order_id: 'nope' }, amount: 39_000_000 })).error?.code, PAYME_ERRORS.order.code);

    const id = paymeId();
    const time = Date.now();
    const created = await payme('CreateTransaction', { id, time, account, amount: 39_000_000 });
    assert.equal(created.result?.['state'], 1, JSON.stringify(created));
    assert.deepEqual((await payme('CreateTransaction', { id, time, account, amount: 39_000_000 })).result, created.result, 'a retried Create answers the same');
    assert.equal((await payme('CreateTransaction', { id: paymeId(), time, account, amount: 39_000_000 })).error?.code, PAYME_ERRORS.orderState.code, 'a second open transaction is refused');

    const [a, b] = await Promise.all([payme('PerformTransaction', { id }), payme('PerformTransaction', { id })]);
    assert.equal(a.result?.['state'], 2, JSON.stringify(a));
    assert.deepEqual(b.result, a.result, 'both answers name the same performance');
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([paid.status, paid.provider, paid.testMode], ['paid', 'payme', false]);
    assert.deepEqual(await until(orgId), addMonths(paid.paidAt ?? new Date(), 1), 'extended once');
    assert.equal(await db.auditEvent.count({ where: { orgId, action: 'billing.paid', targetId: order.id } }), 1);

    assert.deepEqual((await payme('PerformTransaction', { id })).result, a.result, 'a later retry too');
    assert.equal((await payme('CheckTransaction', { id })).result?.['state'], 2);
    assert.equal((await payme('CancelTransaction', { id, reason: 5 })).error?.code, PAYME_ERRORS.cannotCancel.code);
    assert.equal((await payme('CheckPerformTransaction', { account, amount: 39_000_000 })).error?.code, PAYME_ERRORS.orderState.code, 'a paid order is not payable again');
  });

  it('Payme: Cancel before Perform cancels the order and is idempotent; Perform after it is refused', async () => {
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const id = paymeId();
    await payme('CreateTransaction', { id, time: Date.now(), account: { order_id: order.id }, amount: 39_000_000 });
    const cancelled = await payme('CancelTransaction', { id, reason: 3 });
    assert.equal(cancelled.result?.['state'], -1, JSON.stringify(cancelled));
    assert.deepEqual((await payme('CancelTransaction', { id, reason: 3 })).result, cancelled.result);
    assert.equal((await payme('PerformTransaction', { id })).error?.code, PAYME_ERRORS.cannotPerform.code);
    assert.deepEqual((await payme('CheckTransaction', { id })).result?.['reason'], 3);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'cancelled');
    assert.equal(await until(orgId), null);
  });

  it('Payme: a transaction open over 12 hours is cancelled (reason 4) when Perform or Create comes', async () => {
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const id = paymeId();
    await payme('CreateTransaction', { id, time: Date.now(), account: { order_id: order.id }, amount: 39_000_000 });
    await db.paymentTransaction.update({ where: { provider_externalId: { provider: 'payme', externalId: id } }, data: { createTime: BigInt(Date.now() - 13 * 3_600_000) } });
    assert.equal((await payme('PerformTransaction', { id })).error?.code, PAYME_ERRORS.cannotPerform.code);
    const check = (await payme('CheckTransaction', { id })).result;
    assert.deepEqual([check?.['state'], check?.['reason']], [-1, 4]);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'cancelled');
    assert.equal((await payme('CreateTransaction', { id, time: Date.now(), account: { order_id: order.id }, amount: 39_000_000 })).error?.code, PAYME_ERRORS.cannotPerform.code);
    assert.equal(await until(orgId), null);
  });

  it('Payme GetStatement lists the transactions in the window; CheckTransaction and GetStatement still answer after the org is deleted', async () => {
    const { orgId } = await makeUser();
    const order = await subscriptionOrder(orgId);
    orphanOrders.push(order.id);
    const id = paymeId();
    const time = Date.now();
    await payme('CreateTransaction', { id, time, account: { order_id: order.id }, amount: 39_000_000 });
    await payme('PerformTransaction', { id });
    const statement = async () => (((await payme('GetStatement', { from: time - 1000, to: time + 1000 })).result?.['transactions'] ?? []) as { id: string; account: { order_id: string }; state: number }[])
      .find((tx) => tx.id === id);
    assert.deepEqual(await statement().then((tx) => [tx?.account.order_id, tx?.state]), [order.id, 2]);
    assert.equal((await payme('GetStatement', { from: 'x', to: time })).error?.code, PAYME_ERRORS.request.code);

    await db.organization.delete({ where: { id: orgId } });
    const kept = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.deepEqual([kept.orgId, kept.status], [null, 'paid']);
    assert.equal((await payme('CheckTransaction', { id })).result?.['state'], 2);
    assert.deepEqual(await statement().then((tx) => [tx?.account.order_id, tx?.state]), [order.id, 2]);
  });

  it('Payme test mode: an order it confirms is stamped testMode; a production server refuses test mode unless allowed', async () => {
    const sandbox = { ...PAYME, PAYME_TEST_MODE: 'true', PAYME_KEY: undefined, PAYME_TEST_KEY: 'payme-sandbox-key' };
    const auth = `Basic ${Buffer.from('Paycom:payme-sandbox-key').toString('base64')}`;
    const { orgId } = await freshOrg();
    const order = await subscriptionOrder(orgId);
    const id = paymeId();
    await payme('CreateTransaction', { id, time: Date.now(), account: { order_id: order.id }, amount: 39_000_000 }, sandbox, auth);
    assert.equal((await payme('PerformTransaction', { id }, sandbox, auth)).result?.['state'], 2);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).testMode, true);

    const prod = { ...sandbox, NODE_ENV: 'production' };
    assert.equal(billingConfig(prod).payme, null, 'refused on a production server');
    assert.equal(billingConfig({ ...prod, PAYME_TEST_ALLOW_PROD: '1' }).payme?.test, true, 'unless explicitly allowed');
    assert.equal(billingConfig({ ...PAYME, NODE_ENV: 'production' }).payme?.test, false, 'live keys are fine in production');
  });

  it('checkout and the tier rule: a cheaper tier while a dearer one runs is a 403 plan_change; renewal and upgrade are allowed; a paid catalogue is not sold twice', async () => {
    const owner = await freshOrg();
    const cookie = await sessionCookie(owner);
    assert.ok((await recordTransfer({ orgId: owner.orgId, planId: 'accountant_monthly', catalogId: null })).ok);
    const checkout = (planId: string, catalogId: string | null = null) =>
      withEnv(CLICK, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', cookie).send({ planId, catalogId, provider: 'click' }));
    const down = await checkout('company_yearly');
    assert.equal(down.status, 403);
    assert.deepEqual([bodyOf(down).error.code, bodyOf(down).error.message], ['plan_change', ta.setX.plan.planChange]);
    assert.equal(await db.order.count({ where: { orgId: owner.orgId, planId: 'company_yearly' } }), 0, 'no order was made');
    assert.ok(fits(e.checkout.response, (await checkout('accountant_yearly')).body).ok, 'renewal');
    assert.ok(fits(e.checkout.response, (await checkout('firm_monthly')).body).ok, 'upgrade');

    const shop = await freshOrg();
    const shopCookie = await sessionCookie(shop);
    const catalog = (await makeCatalog(shop.orgId, [{ rawName: 'Un', suggestedMxik: null, confidence: null }])).catalogId;
    assert.ok((await recordTransfer({ orgId: shop.orgId, planId: 'catalog_500', catalogId: catalog })).ok);
    const again = await withEnv(CLICK, () => http().post('/api/billing/checkout').set(CSRF).set('Cookie', shopCookie).send({ planId: 'catalog_500', catalogId: catalog, provider: 'click' }));
    assert.deepEqual(again.body, { ok: false, error: ta.setX.billing.alreadyPaid });
  });

  it('an ended plan refuses product, Didox and 1C counterparty uploads with the plan message; a running trial accepts them', async () => {
    const expired = await freshOrg();
    const cookie = await sessionCookie(expired);
    const csv = Buffer.from('Nomi;MXIK\nGuruch;\n');
    const upload = (path: string, name: string, body: Buffer, who = cookie) => http().post(path).set(CSRF).set('Cookie', who).attach('file', body, name);
    const message = ta.msg.gate.expired;
    for (const [path, name, body] of [
      ['/api/products/import/preview', 'list.csv', csv],
      ['/api/didox/upload', 'invoice.json', Buffer.from('{}')],
      ['/api/onec/counterparties/import', 'kontragenty.csv', Buffer.from('Наименование;ИНН\nАльфа;301111111\n')],
    ] as const) {
      const res = await upload(path, name, body);
      assert.ok(res.status < 300, `${path}: ${res.status} ${JSON.stringify(res.body)}`);
      assert.deepEqual([bodyOf<{ ok: boolean; error: string }>(res).ok, bodyOf<{ ok: boolean; error: string }>(res).error], [false, message], path);
    }
    const commit = await http().post('/api/products/import').set(CSRF).set('Cookie', cookie).field('mapping', '{"name":0}').attach('file', csv, 'list.csv');
    assert.equal(bodyOf<{ error: string }>(commit).error, message);
    assert.equal(await db.importBatch.count({ where: { orgId: expired.orgId } }), 0, 'nothing was stored');

    await db.organization.update({ where: { id: expired.orgId }, data: { trialEndsAt: new Date(Date.now() + 86_400_000) } });
    const open = await upload('/api/products/import/preview', 'list.csv', csv);
    assert.equal(bodyOf<{ ok: boolean }>(open).ok, true, JSON.stringify(open.body));
    const counterparties = await upload('/api/onec/counterparties/import', 'kontragenty.csv', Buffer.from('Наименование;ИНН\nАльфа;301111111\n'));
    assert.equal(bodyOf<{ ok: boolean }>(counterparties).ok, true, JSON.stringify(counterparties.body));
    const plan = fits(e.plan.response, (await http().get('/api/billing/plan').set('Cookie', cookie)).body);
    assert.equal(plan.status.usage.rowsPerMonth, 0, 'not counted in the monthly rows (D4)');
  });
});

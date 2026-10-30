// The platform admin's billing view (GET /api/admin/billing): 404 for everyone else, as the other
// admin routes; for a platform admin every customer org with its plan, trial and paid-period ends and
// last paid order, and paid orders of the last 30 days with test-mode orders counted apart.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { recordTransfer } from '@tasnivo/domain/billing/orders';
import { refundOrder } from '@tasnivo/domain/billing/refunds';
import { dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { addMember, fits, sessionCookie, withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.admin;
const DAY = 86_400_000;

describe('admin billing (database)', { skip }, () => {
  let app: INestApplication;
  let platform: TestUser;
  let customer: TestUser;
  let cookie = '';
  const orgs: string[] = [];
  const http = () => request(serverOf(app));
  const asAdmin = <T>(run: () => Promise<T>) => withEnv({ ADMIN_EMAILS: platform.email }, run);
  let lastId = '';

  before(async () => {
    app = await startApp();
    platform = await makeUser();
    customer = await makeUser();
    orgs.push(platform.orgId, customer.orgId);
    await db.user.update({ where: { id: platform.userId }, data: { platformAdmin: true } });
    cookie = await sessionCookie(platform);
    const trialEnd = new Date(Date.now() + 5 * DAY);
    await db.organization.update({ where: { id: customer.orgId }, data: { trialEndsAt: trialEnd } });
    // Two real payments, one refunded later, one 40 days old and one in test mode.
    assert.ok((await recordTransfer({ orgId: customer.orgId, planId: 'company_monthly', catalogId: null })).ok);
    const refunded = await recordTransfer({ orgId: customer.orgId, planId: 'company_monthly', catalogId: null });
    assert.ok(refunded.ok);
    assert.ok((await refundOrder({ orderId: refunded.orderId, days: 3 })).ok);
    await db.order.create({ data: { orgId: customer.orgId, planId: 'catalog_500', amount: 700_000, provider: 'click', status: 'paid', paidAt: new Date(Date.now() - 40 * DAY) } });
    lastId = (await db.order.create({ data: { orgId: customer.orgId, planId: 'company_monthly', amount: 390_000, provider: 'payme', status: 'paid', paidAt: new Date(), testMode: true } })).id;
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('404 without a session, for an org admin or accountant, and for a flagged user missing from ADMIN_EMAILS', async () => {
    assert.equal((await http().get('/api/admin/billing')).status, 404);
    for (const who of [customer, await addMember(customer.orgId, 'accountant')]) {
      const c = await sessionCookie(who);
      assert.equal((await asAdmin(() => http().get('/api/admin/billing').set('Cookie', c))).status, 404);
    }
    assert.equal((await withEnv({ ADMIN_EMAILS: 'someone@else.test' }, () => http().get('/api/admin/billing').set('Cookie', cookie))).status, 404);
  });

  it('the org\'s plan, ends, last paid order and 30-day counts, test mode apart', async () => {
    const res = await asAdmin(() => http().get('/api/admin/billing').set('Cookie', cookie));
    assert.equal(res.status, 200);
    const body = fits(e.billing.response, res.body);
    const row = body.orgs.find((o) => o.id === customer.orgId);
    assert.ok(row);
    const org = await db.organization.findUniqueOrThrow({ where: { id: customer.orgId } });
    assert.equal(row.state, 'firm');
    assert.equal(row.tier, 'company');
    assert.equal(row.subscriptionUntil, org.subscriptionUntil!.toISOString());
    assert.equal(row.trialEndsAt, org.trialEndsAt!.toISOString());
    assert.equal(row.closedAt, null);
    // The newest paid order is the test-mode one, flagged as such.
    assert.equal(row.lastPaid?.id, lastId);
    assert.equal(row.lastPaid?.testMode, true);
    // One real payment in the window (the refunded one and the 40-day-old one are out), one test payment.
    assert.deepEqual(row.last30, { count: 1, sum: 390_000, test: 1 });
    assert.ok(body.last30.count >= 1 && body.last30.sum >= 390_000 && body.last30.test >= 1);
    // Customer orgs only: a demo copy is never listed.
    const demo = await makeUser({ kind: 'demo' });
    orgs.push(demo.orgId);
    const again = fits(e.billing.response, (await asAdmin(() => http().get('/api/admin/billing').set('Cookie', cookie))).body);
    assert.equal(again.orgs.some((o) => o.id === demo.orgId), false);
  });

  it('pages the orgs, 50 by default, while the 30-day figures cover every org', async () => {
    const get = (query: string) => asAdmin(() => http().get(`/api/admin/billing${query}`).set('Cookie', cookie));
    const first = fits(e.billing.response, (await get('')).body);
    assert.equal(first.page, 1);
    assert.equal(first.pageSize, 50);
    assert.ok(first.orgs.length <= 50);
    assert.equal(first.pageCount, Math.max(1, Math.ceil(first.total / 50)));
    // A page of one past the end answers the last page: the oldest org, not this test's customer,
    // and still the customer's payments in the platform-wide window.
    const res = await get('?pageSize=1&page=10000');
    assert.equal(res.status, 200);
    const last = fits(e.billing.response, res.body);
    assert.equal(last.pageSize, 1);
    assert.equal(last.orgs.length, 1);
    assert.equal(last.pageCount, last.total);
    assert.equal(last.page, last.pageCount);
    assert.notEqual(last.orgs[0]?.id, customer.orgId);
    assert.ok(last.last30.count >= 1 && last.last30.sum >= 390_000 && last.last30.test >= 1);
    for (const bad of ['?page=0', '?page=abc', '?pageSize=0', '?pageSize=201']) {
      assert.equal((await get(bad)).status, 400, bad);
    }
  });
});

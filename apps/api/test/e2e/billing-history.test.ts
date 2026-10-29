// The org's billing history (GET /api/billing/orders) and a paid order's receipt
// (GET /api/billing/orders/{orderId}): admins of the org only (an accountant or a viewer gets 403),
// in the contract's shape with the test-mode flag and the period end, and never another org's order.
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { endpoints } from '@tasnivo/contracts';
import { db } from '@tasnivo/db';
import { recordTransfer } from '@tasnivo/domain/billing/orders';
import { refundOrder } from '@tasnivo/domain/billing/refunds';
import { bodyOf, dbSkipReason, dropOrgs, makeUser, serverOf, startApp, type TestUser } from '../helpers';
import { addMember, fits, sessionCookie } from '../w2d-support';

const skip = await dbSkipReason();
const e = endpoints.billing;

describe('billing history and receipts (database)', { skip }, () => {
  let app: INestApplication;
  let admin: TestUser;
  let other: TestUser;
  let adminCookie = '';
  let otherCookie = '';
  let paidId = '';
  let testId = '';
  let openId = '';
  let refundedId = '';
  let otherOrderId = '';
  const orgs: string[] = [];
  const http = () => request(serverOf(app));

  before(async () => {
    app = await startApp();
    admin = await makeUser();
    other = await makeUser();
    orgs.push(admin.orgId, other.orgId);
    adminCookie = await sessionCookie(admin);
    otherCookie = await sessionCookie(other);
    const transfer = await recordTransfer({ orgId: admin.orgId, planId: 'company_monthly', catalogId: null });
    assert.ok(transfer.ok);
    paidId = transfer.orderId;
    testId = (await db.order.create({ data: { orgId: admin.orgId, orgName: 'Sinov MChJ', planId: 'company_monthly', amount: 390_000, provider: 'payme', status: 'paid', paidAt: new Date(), testMode: true } })).id;
    openId = (await db.order.create({ data: { orgId: admin.orgId, planId: 'firm_yearly', amount: 18_000_000, provider: 'click' } })).id;
    const refunded = await recordTransfer({ orgId: admin.orgId, planId: 'company_monthly', catalogId: null });
    assert.ok(refunded.ok);
    refundedId = refunded.orderId;
    assert.ok((await refundOrder({ orderId: refundedId })).ok);
    const otherTransfer = await recordTransfer({ orgId: other.orgId, planId: 'firm_monthly', catalogId: null });
    assert.ok(otherTransfer.ok);
    otherOrderId = otherTransfer.orderId;
  });
  after(async () => {
    await app.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('lists the org\'s orders newest first in the contract\'s shape, with test mode and the period end', async () => {
    const res = await http().get('/api/billing/orders').set('Cookie', adminCookie);
    assert.equal(res.status, 200);
    const rows = fits(e.orders.response, res.body);
    assert.deepEqual(rows.map((r) => r.id).sort(), [paidId, testId, openId, refundedId].sort());
    assert.deepEqual(rows.map((r) => r.id), [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => r.id));
    const paid = rows.find((r) => r.id === paidId)!;
    assert.equal(paid.status, 'paid');
    assert.equal(paid.provider, 'bank');
    assert.equal(paid.kind, 'subscription');
    assert.equal(paid.tier, 'company');
    assert.equal(paid.months, 1);
    assert.equal(paid.amount, 390_000);
    assert.equal(paid.testMode, false);
    const event = await db.auditEvent.findFirstOrThrow({ where: { orgId: admin.orgId, action: 'billing.paid', targetId: paidId } });
    assert.equal(paid.periodEnd, (event.payload as { until: string }).until);
    assert.equal(rows.find((r) => r.id === testId)!.testMode, true);
    assert.equal(rows.find((r) => r.id === openId)!.status, 'created');
    assert.equal(rows.find((r) => r.id === openId)!.paidAt, null);
    assert.equal(rows.find((r) => r.id === refundedId)!.status, 'refunded');
  });

  it('another org\'s orders are never listed, and its receipts are 404', async () => {
    const mine = fits(e.orders.response, (await http().get('/api/billing/orders').set('Cookie', adminCookie)).body);
    assert.equal(mine.some((r) => r.id === otherOrderId), false);
    const theirs = fits(e.orders.response, (await http().get('/api/billing/orders').set('Cookie', otherCookie)).body);
    assert.deepEqual(theirs.map((r) => r.id), [otherOrderId]);
    assert.equal((await http().get(`/api/billing/orders/${otherOrderId}`).set('Cookie', adminCookie)).status, 404);
    assert.equal((await http().get(`/api/billing/orders/${paidId}`).set('Cookie', otherCookie)).status, 404);
  });

  it('a receipt for a paid or refunded order; an unpaid or unknown one is 404', async () => {
    const res = await http().get(`/api/billing/orders/${testId}`).set('Cookie', adminCookie);
    assert.equal(res.status, 200);
    const receipt = fits(e.receipt.response, res.body);
    assert.equal(receipt.orgName, 'Sinov MChJ');
    assert.equal(receipt.testMode, true);
    assert.equal(fits(e.receipt.response, (await http().get(`/api/billing/orders/${refundedId}`).set('Cookie', adminCookie)).body).status, 'refunded');
    assert.equal((await http().get(`/api/billing/orders/${openId}`).set('Cookie', adminCookie)).status, 404);
    assert.equal((await http().get('/api/billing/orders/nope').set('Cookie', adminCookie)).status, 404);
  });

  it('an accountant or a viewer gets 403; without a session 401', async () => {
    for (const role of ['accountant', 'viewer'] as const) {
      const cookie = await sessionCookie(await addMember(admin.orgId, role));
      for (const path of ['/api/billing/orders', `/api/billing/orders/${paidId}`]) {
        const res = await http().get(path).set('Cookie', cookie);
        assert.equal(res.status, 403, `${role} ${path}`);
        assert.equal(bodyOf(res).error.code, 'forbidden');
      }
    }
    assert.equal((await http().get('/api/billing/orders')).status, 401);
  });
});

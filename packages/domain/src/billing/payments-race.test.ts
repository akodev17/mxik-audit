// Payments under concurrency and over time: two confirmations of one order extend the subscription
// once; two renewals of one org both count; abandoned orders expire after 24 hours unless a provider
// transaction is still open; an org's orders and provider transactions outlive the org.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeOrg } from '../test-fixtures';
import { expireStaleOrders, markPaid } from './orders';
import { addMonths } from './period';
import { planById } from './plans';

const skip = await dbSkipReason();
const HOUR = 3_600_000;

describe('payments: races, expiry, purge (database)', { skip }, () => {
  const orgs: string[] = [];
  const orphans: string[] = [];
  const org = async () => {
    const o = await makeOrg();
    orgs.push(o.orgId);
    return o.orgId;
  };
  const order = (orgId: string, planId: string, extra: { createdAt?: Date } = {}) =>
    db.order.create({ data: { orgId, planId, amount: planById(planId)?.price ?? 0, provider: 'payme', ...extra } });
  const until = async (orgId: string) => (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).subscriptionUntil;

  after(async () => {
    await db.order.deleteMany({ where: { id: { in: orphans } } });
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('two concurrent confirmations of one order: one is paid, the other is not, and the period is extended once', async () => {
    const orgId = await org();
    const o = await order(orgId, 'company_monthly');
    const seen: string[] = [];
    const results = await Promise.all([
      markPaid(o.id, 'payme', { within: () => { seen.push('a'); return Promise.resolve(); } }),
      markPaid(o.id, 'click', { within: () => { seen.push('b'); return Promise.resolve(); } }),
    ]);
    assert.deepEqual([...results].sort(), ['not_payable', 'paid']);
    assert.equal(seen.length, 1, 'the provider state is written by the winner only');
    const paid = await db.order.findUniqueOrThrow({ where: { id: o.id } });
    assert.equal(paid.status, 'paid');
    assert.deepEqual(await until(orgId), addMonths(paid.paidAt ?? new Date(), 1), 'one month, not two');
    assert.equal(await db.auditEvent.count({ where: { orgId, action: 'billing.paid', targetId: o.id } }), 1);
    // A replay later changes nothing either.
    assert.equal(await markPaid(o.id, 'payme'), 'not_payable');
    assert.deepEqual(await until(orgId), addMonths(paid.paidAt ?? new Date(), 1));
  });

  it('two renewals of one org paid at once both count: the second starts from the first one\'s end', async () => {
    const orgId = await org();
    const [a, b] = await Promise.all([order(orgId, 'company_monthly'), order(orgId, 'company_monthly')]);
    assert.deepEqual(await Promise.all([markPaid(a.id, 'payme'), markPaid(b.id, 'click')]), ['paid', 'paid']);
    const first = (await db.order.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { paidAt: 'asc' } }))[0];
    assert.deepEqual(await until(orgId), addMonths(addMonths(first?.paidAt ?? new Date(), 1), 1));
  });

  it('a provider step that throws rolls the claim back: the order stays payable', async () => {
    const orgId = await org();
    const o = await order(orgId, 'accountant_monthly');
    await assert.rejects(markPaid(o.id, 'payme', { within: () => Promise.reject(new Error('cancelled meanwhile')) }), /cancelled meanwhile/);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: o.id } })).status, 'created');
    assert.equal(await until(orgId), null);
    assert.equal(await markPaid(o.id, 'payme', { testMode: true }), 'paid');
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: o.id } })).testMode, true, 'a sandbox payment is stamped');
  });

  it('orders left at "created" for over 24 hours are cancelled, unless a provider transaction is still open', async () => {
    const orgId = await org();
    const now = new Date();
    const stale = await order(orgId, 'company_monthly', { createdAt: new Date(now.getTime() - 25 * HOUR) });
    const fresh = await order(orgId, 'company_monthly', { createdAt: new Date(now.getTime() - HOUR) });
    const open = await order(orgId, 'company_monthly', { createdAt: new Date(now.getTime() - 25 * HOUR) });
    await db.paymentTransaction.create({
      data: { orderId: open.id, provider: 'payme', externalId: `race-${open.id}`, amountTiyin: 39_000_000n, state: 1, createTime: BigInt(now.getTime() - HOUR) },
    });
    const paid = await order(orgId, 'company_monthly', { createdAt: new Date(now.getTime() - 25 * HOUR) });
    assert.equal(await markPaid(paid.id, 'payme'), 'paid');

    assert.ok((await expireStaleOrders(now)) >= 1);
    const status = async (id: string) => (await db.order.findUniqueOrThrow({ where: { id } })).status;
    assert.equal(await status(stale.id), 'cancelled');
    assert.equal(await status(fresh.id), 'created');
    assert.equal(await status(open.id), 'created');
    assert.equal(await status(paid.id), 'paid');
    assert.equal(await markPaid(stale.id, 'payme'), 'not_payable', 'an expired order is never paid');
  });

  it('deleting an org keeps its orders and provider transactions (orgId null, the name kept)', async () => {
    const { orgId } = await makeOrg();
    const o = await db.order.create({ data: { orgId, orgName: 'Kept Ltd', planId: 'firm_monthly', amount: 1_800_000, provider: 'payme' } });
    orphans.push(o.id);
    await db.paymentTransaction.create({ data: { orderId: o.id, provider: 'payme', externalId: `purge-${o.id}`, amountTiyin: 180_000_000n, state: 2, createTime: BigInt(Date.now()) } });
    await db.organization.delete({ where: { id: orgId } });
    const kept = await db.order.findUniqueOrThrow({ where: { id: o.id }, include: { transactions: true } });
    assert.deepEqual([kept.orgId, kept.orgName, kept.transactions.length], [null, 'Kept Ltd', 1]);
    assert.equal(await markPaid(o.id, 'payme'), 'not_payable', 'an order without an org is never paid');
  });
});

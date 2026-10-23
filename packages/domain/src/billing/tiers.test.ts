// A paid subscription's tier sets the limits the app enforces; a yearly payment buys 12 months; a
// bank transfer recorded by the owner works like a provider's callback.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { monthlyCheckCap } from '../api/limits';
import { planStatus } from '../plan';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg } from '../test-fixtures';
import { billingPlan } from './overview';
import { catalogPaid, markPaid, recordTransfer } from './orders';
import { PLANS } from './plans';

const skip = await dbSkipReason();
const DAY = 86_400_000;

describe('subscription tiers (database)', { skip }, () => {
  const orgs: string[] = [];
  const org = async () => {
    const o = await makeOrg();
    orgs.push(o.orgId);
    return o;
  };
  const paidUntil = async (orgId: string): Promise<Date> => (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).subscriptionUntil ?? new Date(0);
  const paidOrder = async (orgId: string, planId: string, amount: number) => {
    const order = await db.order.create({ data: { orgId, planId, amount, provider: 'click' } });
    assert.equal(await markPaid(order.id, 'click'), true);
  };

  after(async () => {
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('a trial uses the trial limits and has no tier', async () => {
    const { orgId } = await org();
    await db.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * DAY) } });
    const status = await planStatus(orgId);
    assert.equal(status.state, 'trial');
    assert.equal(status.tier, null);
    assert.deepEqual(status.limits, PLANS.trial.limits);
    assert.equal(monthlyCheckCap(status), PLANS.trial.apiChecks);
  });

  it('a monthly company payment: one month, the company tier\'s limits', async () => {
    const { orgId } = await org();
    const before = Date.now();
    await paidOrder(orgId, 'company_monthly', 390_000);
    const status = await planStatus(orgId);
    assert.equal(status.state, 'firm');
    assert.equal(status.tier, 'company');
    assert.deepEqual(status.limits, PLANS.tiers.company.limits);
    assert.equal(monthlyCheckCap(status), PLANS.tiers.company.apiChecks);
    const days = ((await paidUntil(orgId)).getTime() - before) / DAY;
    assert.ok(days >= 27 && days <= 32, `one month, got ${days} days`);
  });

  it('a yearly accountant payment: twelve months on top of what is left, then the newest tier applies', async () => {
    const { orgId } = await org();
    await paidOrder(orgId, 'company_monthly', 390_000);
    const afterMonth = await paidUntil(orgId);
    await paidOrder(orgId, 'accountant_yearly', 9_000_000);
    const afterYear = await paidUntil(orgId);
    const days = (afterYear.getTime() - afterMonth.getTime()) / DAY;
    assert.ok(days >= 365 && days <= 366, `a year added, got ${days} days`);
    const status = await planStatus(orgId);
    assert.equal(status.tier, 'accountant');
    assert.deepEqual(status.limits, PLANS.tiers.accountant.limits);
    const billing = await billingPlan({ orgId, role: 'admin' }, false);
    assert.equal(billing.plan?.id, 'accountant_yearly');
    assert.equal(billing.tiers.length, 3);
  });

  it('an order recorded as firm_monthly before the tiers, and a subscription set by hand, are the top tier', async () => {
    const legacy = await org();
    await paidOrder(legacy.orgId, 'firm_monthly', 450_000);
    assert.equal((await planStatus(legacy.orgId)).tier, 'firm');
    const manual = await org();
    await db.organization.update({ where: { id: manual.orgId }, data: { subscriptionUntil: new Date(Date.now() + 30 * DAY) } });
    const status = await planStatus(manual.orgId);
    assert.equal(status.tier, 'firm');
    assert.deepEqual(status.limits, PLANS.tiers.firm.limits);
  });

  it('a bank transfer: a paid "bank" order, the agreed amount, the same effects as a callback', async () => {
    const { orgId } = await org();
    const done = await recordTransfer({ orgId, planId: 'firm_yearly', catalogId: null, amount: 15_000_000 });
    assert.ok(done.ok);
    const order = await db.order.findUniqueOrThrow({ where: { id: done.orderId } });
    assert.deepEqual([order.status, order.provider, order.amount, order.planId], ['paid', 'bank', 15_000_000, 'firm_yearly']);
    assert.equal((await planStatus(orgId)).tier, 'firm');
    assert.deepEqual(await recordTransfer({ orgId, planId: 'nope', catalogId: null }), { ok: false, reason: 'unknown_plan' });

    const shop = await org();
    const { catalogId } = await makeCatalog(shop.orgId, [{ rawName: 'Sement', suggestedMxik: null, confidence: null }]);
    assert.deepEqual(await recordTransfer({ orgId: shop.orgId, planId: 'catalog_500', catalogId: null }), { ok: false, reason: 'catalog' });
    assert.deepEqual(await recordTransfer({ orgId: shop.orgId, planId: 'catalog_2000', catalogId }), { ok: false, reason: 'catalog' });
    assert.equal((await recordTransfer({ orgId: shop.orgId, planId: 'catalog_500', catalogId })).ok, true);
    assert.equal(await catalogPaid(shop.orgId, catalogId), true);
    assert.equal((await planStatus(shop.orgId)).state, 'expired', 'a catalogue payment is not a subscription');
  });
});

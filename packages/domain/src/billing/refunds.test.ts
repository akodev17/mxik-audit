// Refunds recorded by hand (npm run billing:refund): paid → refunded once, the paid period shortened
// by the order's months or by --days (never before now), an audit event, the tier kept for the days
// left, a catalogue locked again; anything not paid is refused and changes nothing.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { planStatus } from '../plan';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg } from '../test-fixtures';
import { catalogPaid } from './orders';
import { addMonths } from './period';
import { refundOrder, shortenedUntil } from './refunds';

const skip = await dbSkipReason();
const DAY = 86_400_000;

describe('shortenedUntil', () => {
  const now = new Date('2031-05-10T10:00:00Z');
  it('takes the months back, or the days, never before now; an end already past is kept', () => {
    assert.deepEqual(shortenedUntil(new Date('2031-07-31T10:00:00Z'), now, { months: 1 }), new Date('2031-06-30T10:00:00Z'));
    assert.deepEqual(shortenedUntil(new Date('2031-07-31T10:00:00Z'), now, { days: 10, months: 1 }), new Date('2031-07-21T10:00:00Z'));
    assert.deepEqual(shortenedUntil(new Date('2031-05-20T10:00:00Z'), now, { months: 1 }), now);
    assert.deepEqual(shortenedUntil(new Date('2031-05-20T10:00:00Z'), now, { days: 30, months: 1 }), now);
    assert.deepEqual(shortenedUntil(new Date('2031-05-01T10:00:00Z'), now, { months: 12 }), new Date('2031-05-01T10:00:00Z'));
  });
});

describe('refunds (database)', { skip }, () => {
  const orgs: string[] = [];
  const orphans: string[] = [];
  after(async () => {
    await db.order.deleteMany({ where: { id: { in: orphans } } });
    await dropOrgs(orgs);
  });
  const org = async (subscriptionUntil: Date | null) => {
    const o = await makeOrg();
    orgs.push(o.orgId);
    await db.organization.update({ where: { id: o.orgId }, data: { subscriptionUntil } });
    return o;
  };
  const paid = (orgId: string | null, planId: string, amount: number, extra: { catalogId?: string; paidAt?: Date } = {}) =>
    db.order.create({ data: { orgId, planId, amount, provider: 'click', status: 'paid', paidAt: extra.paidAt ?? new Date(), catalogId: extra.catalogId ?? null } });
  const until = async (orgId: string) => (await db.organization.findUniqueOrThrow({ where: { id: orgId } })).subscriptionUntil;

  it('a renewal refunded: its month comes off the end, the tier stays, an audit event records it', async () => {
    const end = new Date(Date.now() + 45 * DAY);
    const o = await org(end);
    await paid(o.orgId, 'accountant_monthly', 900_000, { paidAt: new Date(Date.now() - 20 * DAY) });
    const renewal = await paid(o.orgId, 'accountant_monthly', 900_000);
    const result = await refundOrder({ orderId: renewal.id, note: 'customer asked' });
    assert.ok(result.ok);
    assert.deepEqual(result.refund.until, { before: end, after: addMonths(end, -1) });
    assert.deepEqual(await until(o.orgId), addMonths(end, -1));
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: renewal.id } })).status, 'refunded');
    const status = await planStatus(o.orgId);
    assert.equal(status.state, 'firm');
    assert.equal(status.tier, 'accountant');
    const event = await db.auditEvent.findFirstOrThrow({ where: { orgId: o.orgId, action: 'billing.refunded', targetId: renewal.id } });
    assert.deepEqual(event.payload, {
      planId: 'accountant_monthly', amount: 900_000, provider: 'click', catalogId: null, testMode: false, days: null, note: 'customer asked',
      until: { before: end.toISOString(), after: addMonths(end, -1).toISOString() },
    });
  });

  it('--days takes those days back; the only order refunded in part keeps its tier for the days left', async () => {
    const end = new Date(Date.now() + 25 * DAY);
    const o = await org(end);
    const order = await paid(o.orgId, 'company_monthly', 390_000);
    const result = await refundOrder({ orderId: order.id, days: 10 });
    assert.ok(result.ok);
    assert.deepEqual(await until(o.orgId), new Date(end.getTime() - 10 * DAY));
    // Not the top tier: the refunded order still names the tier in force.
    assert.equal((await planStatus(o.orgId)).tier, 'company');
  });

  it('a full refund of a period that started with this order ends it now', async () => {
    const o = await org(new Date(Date.now() + 25 * DAY));
    const order = await paid(o.orgId, 'company_monthly', 390_000);
    const before = Date.now();
    assert.ok((await refundOrder({ orderId: order.id })).ok);
    const after = (await until(o.orgId))!.getTime();
    assert.ok(after >= before && after <= Date.now(), 'ends now');
    assert.equal((await planStatus(o.orgId)).state, 'expired');
  });

  it('a catalogue order refunded locks the catalogue again; the paid period is not touched', async () => {
    const o = await org(null);
    const { catalogId } = await makeCatalog(o.orgId, [{ rawName: 'Guruch', suggestedMxik: null, confidence: null }]);
    const order = await paid(o.orgId, 'catalog_500', 700_000, { catalogId });
    assert.equal(await catalogPaid(o.orgId, catalogId), true);
    const result = await refundOrder({ orderId: order.id });
    assert.ok(result.ok);
    assert.deepEqual(result.refund.until, { before: null, after: null });
    assert.equal(await catalogPaid(o.orgId, catalogId), false);
    assert.equal(await until(o.orgId), null);
  });

  it('refused, changing nothing: unknown, unpaid, already refunded, bad days; two at once refund once', async () => {
    const end = new Date(Date.now() + 60 * DAY);
    const o = await org(end);
    assert.deepEqual(await refundOrder({ orderId: 'no-such-order' }), { ok: false, reason: 'not_found' });
    const open = await db.order.create({ data: { orgId: o.orgId, planId: 'company_monthly', amount: 390_000, provider: 'click' } });
    assert.deepEqual(await refundOrder({ orderId: open.id }), { ok: false, reason: 'not_paid' });
    const order = await paid(o.orgId, 'company_monthly', 390_000);
    assert.deepEqual(await refundOrder({ orderId: order.id, days: 0 }), { ok: false, reason: 'bad_days' });
    assert.deepEqual(await refundOrder({ orderId: order.id, days: 1.5 }), { ok: false, reason: 'bad_days' });
    assert.deepEqual(await until(o.orgId), end);
    const both = await Promise.all([refundOrder({ orderId: order.id, days: 5 }), refundOrder({ orderId: order.id, days: 5 })]);
    assert.equal(both.filter((r) => r.ok).length, 1);
    assert.deepEqual(both.find((r) => !r.ok), { ok: false, reason: 'not_paid' });
    assert.deepEqual(await until(o.orgId), new Date(end.getTime() - 5 * DAY));
    assert.equal(await db.auditEvent.count({ where: { orgId: o.orgId, action: 'billing.refunded' } }), 1);
  });

  it('an order whose org was purged is marked refunded without an audit event', async () => {
    const order = await paid(null, 'company_monthly', 390_000);
    orphans.push(order.id);
    const result = await refundOrder({ orderId: order.id });
    assert.ok(result.ok);
    assert.equal(result.refund.orgId, null);
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'refunded');
  });
});

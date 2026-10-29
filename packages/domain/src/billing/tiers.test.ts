// A paid subscription's tier sets the limits the app enforces; a yearly payment buys 12 months; the
// tier rule (plan D2): the same tier renews from the current end, a dearer tier starts now with the
// unused days credited at the price ratio, a cheaper one waits until the subscription ends; a bank
// transfer recorded by the owner works like a provider's callback.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { i18nFor } from '@tasnivo/i18n/locale';
import { saveBrandingForm } from '../account-settings';
import { monthlyCheckCap } from '../api/limits';
import { makeClient, makePerson } from '../firm-test-fixtures';
import { reportPdfData } from '../pdf/report-data';
import { planStatus } from '../plan';
import { saveClientSchedule } from '../reminder-ops';
import { shareCreateFor } from '../share';
import { dbSkipReason, dropOrgs, makeCatalog, makeOrg } from '../test-fixtures';
import { billingPlan } from './overview';
import { catalogPaid, createOrder, markPaid, recordTransfer } from './orders';
import { addMonths, creditDays } from './period';
import { planById, PLANS } from './plans';

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
  const order = (orgId: string, planId: string) => db.order.create({ data: { orgId, planId, amount: planById(planId)?.price ?? 0, provider: 'click' } });
  const paidOrder = async (orgId: string, planId: string, amount?: number) => {
    const o = await db.order.create({ data: { orgId, planId, amount: amount ?? planById(planId)?.price ?? 0, provider: 'click' } });
    assert.equal(await markPaid(o.id, 'click'), 'paid');
    return db.order.findUniqueOrThrow({ where: { id: o.id } });
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

  it('a monthly company payment: one calendar month from the payment, the company tier\'s limits', async () => {
    const { orgId } = await org();
    const paid = await paidOrder(orgId, 'company_monthly');
    const status = await planStatus(orgId);
    assert.equal(status.state, 'firm');
    assert.equal(status.tier, 'company');
    assert.deepEqual(status.limits, PLANS.tiers.company.limits);
    assert.equal(monthlyCheckCap(status), PLANS.tiers.company.apiChecks);
    assert.deepEqual(await paidUntil(orgId), addMonths(paid.paidAt ?? new Date(), 1));
  });

  it('paying during the trial starts the period now: the trial\'s remaining days are not added', async () => {
    const { orgId } = await org();
    await db.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() + 10 * DAY) } });
    const paid = await paidOrder(orgId, 'company_monthly');
    assert.deepEqual(await paidUntil(orgId), addMonths(paid.paidAt ?? new Date(), 1));
    assert.equal((await planStatus(orgId)).state, 'firm');
  });

  it('the same tier renews from the current end: a yearly company payment adds twelve months to what is left', async () => {
    const { orgId } = await org();
    await paidOrder(orgId, 'company_monthly');
    const afterMonth = await paidUntil(orgId);
    await paidOrder(orgId, 'company_yearly');
    assert.deepEqual(await paidUntil(orgId), addMonths(afterMonth, 12));
    const status = await planStatus(orgId);
    assert.equal(status.tier, 'company');
    const billing = await billingPlan({ orgId, role: 'admin' }, false);
    assert.equal(billing.plan?.id, 'company_yearly');
    assert.equal(billing.tiers.length, 3);
  });

  it('an upgrade starts now; the unused days become days of the new tier at the price ratio (floored)', async () => {
    const { orgId } = await org();
    await paidOrder(orgId, 'company_monthly');
    const companyEnd = await paidUntil(orgId);
    const upgrade = await paidOrder(orgId, 'accountant_yearly');
    const at = upgrade.paidAt ?? new Date();
    const credit = creditDays(companyEnd.getTime() - at.getTime(), 'company', 'accountant');
    assert.equal(credit, Math.floor(((companyEnd.getTime() - at.getTime()) / DAY) * 390_000 / 900_000));
    assert.ok(credit >= 11 && credit <= 13, `about 30 days × 0.43, got ${credit}`);
    assert.deepEqual(await paidUntil(orgId), new Date(addMonths(at, 12).getTime() + credit * DAY));
    const status = await planStatus(orgId);
    assert.equal(status.tier, 'accountant');
    assert.deepEqual(status.limits, PLANS.tiers.accountant.limits);
    const event = await db.auditEvent.findFirstOrThrow({ where: { orgId, action: 'billing.paid', targetId: upgrade.id } });
    assert.deepEqual([(event.payload as { period?: string }).period, (event.payload as { creditDays?: number }).creditDays], ['upgrade', credit]);
  });

  it('a cheaper tier is refused while a dearer one runs (checkout, callback, transfer); --force converts; after expiry it is allowed', async () => {
    const o = await org();
    const actor = { ...(await makePerson(o.orgId, 'admin')), orgId: o.orgId };
    await paidOrder(o.orgId, 'accountant_monthly');
    const accountantEnd = await paidUntil(o.orgId);

    assert.deepEqual(await createOrder(actor, { planId: 'company_monthly', catalogId: null }, 'click'), { ok: false, reason: 'plan_change' });
    assert.equal((await createOrder(actor, { planId: 'accountant_yearly', catalogId: null }, 'click')).ok, true, 'renewal of the same tier');
    assert.equal((await createOrder(actor, { planId: 'firm_monthly', catalogId: null }, 'payme')).ok, true, 'an upgrade');

    // An order made before the subscription (or by a race) is refused at payment and stays unpaid.
    const early = await order(o.orgId, 'company_yearly');
    assert.equal(await markPaid(early.id, 'click'), 'plan_change');
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: early.id } })).status, 'created');
    assert.deepEqual(await paidUntil(o.orgId), accountantEnd);
    assert.equal((await planStatus(o.orgId)).tier, 'accountant');

    assert.deepEqual(await recordTransfer({ orgId: o.orgId, planId: 'company_monthly', catalogId: null }), { ok: false, reason: 'plan_change' });
    assert.equal(await db.order.count({ where: { orgId: o.orgId, provider: 'bank', status: 'created' } }), 0, 'the refused transfer leaves no open order');
    const forced = await recordTransfer({ orgId: o.orgId, planId: 'company_monthly', catalogId: null, force: true });
    assert.ok(forced.ok);
    const at = (await db.order.findUniqueOrThrow({ where: { id: forced.orderId } })).paidAt ?? new Date();
    const credit = creditDays(accountantEnd.getTime() - at.getTime(), 'accountant', 'company');
    assert.ok(credit >= 64 && credit <= 72, `about 30 days × 2.3, got ${credit}`);
    assert.deepEqual(await paidUntil(o.orgId), new Date(addMonths(at, 1).getTime() + credit * DAY));
    assert.equal((await planStatus(o.orgId)).tier, 'company');

    const lapsed = await org();
    await paidOrder(lapsed.orgId, 'firm_monthly');
    await db.organization.update({ where: { id: lapsed.orgId }, data: { subscriptionUntil: new Date(Date.now() - DAY) } });
    const after = await paidOrder(lapsed.orgId, 'company_monthly');
    assert.deepEqual(await paidUntil(lapsed.orgId), addMonths(after.paidAt ?? new Date(), 1));
    assert.equal((await planStatus(lapsed.orgId)).tier, 'company');
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

  it('features: the app refuses what the plan card marks "—" (reminders, branded PDF, client links)', async () => {
    const { ta } = i18nFor('uz');
    const refused = (feature: string) => ({ error: ta.prX.notInPlan(feature) });
    const setUp = async (planId: string | null) => {
      const o = await org();
      if (planId) await paidOrder(o.orgId, planId);
      else await db.organization.update({ where: { id: o.orgId }, data: { trialEndsAt: new Date(Date.now() + 14 * DAY) } });
      const admin = await makePerson(o.orgId, 'admin');
      const clientId = await makeClient(o.orgId, 'Mijoz');
      const { catalogId } = await makeCatalog(o.orgId, [{ rawName: 'Sement', suggestedMxik: null, confidence: null }]);
      const who = { ...admin, orgId: o.orgId, clientIds: null };
      return {
        reminders: await saveClientSchedule(who, clientId, { dayOfMonth: 5, assigneeId: null, enabled: true }, 'uz'),
        branding: await saveBrandingForm(who, { brandName: 'Hisob Pro', removeLogo: false, logo: null }, 'uz'),
        clearBranding: await saveBrandingForm(who, { brandName: '', removeLogo: true, logo: null }, 'uz'),
        share: await shareCreateFor(who, { catalogId, days: 7, includePdf: true }),
        pdfFirm: (await reportPdfData(o.orgId, catalogId))?.firmName,
      };
    };

    const trial = await setUp(null);
    assert.deepEqual(trial.reminders, { ok: false, error: ta.prX.notInPlan(ta.prX.features.reminders) });
    assert.deepEqual(trial.branding, refused(ta.prX.features.branding));
    assert.deepEqual(trial.clearBranding, { saved: true }, 'clearing is always allowed');
    assert.equal(trial.share, null);

    const company = await setUp('company_monthly');
    assert.equal(company.reminders.ok, true);
    assert.deepEqual(company.branding, refused(ta.prX.features.branding));
    assert.equal(company.share, null);

    const accountant = await setUp('accountant_monthly');
    assert.equal(accountant.reminders.ok, true);
    assert.deepEqual(accountant.branding, { saved: true });
    assert.ok(accountant.share?.url);

    // A name saved while the plan had branded PDFs is not printed once the plan no longer has them.
    const o = await org();
    await db.organization.update({ where: { id: o.orgId }, data: { brandName: 'Eski brend', trialEndsAt: new Date(Date.now() + DAY) } });
    const { catalogId } = await makeCatalog(o.orgId, [{ rawName: 'Gʻisht', suggestedMxik: null, confidence: null }]);
    assert.notEqual((await reportPdfData(o.orgId, catalogId))?.firmName, 'Eski brend');
    await paidOrder(o.orgId, 'firm_monthly', 1_800_000);
    assert.equal((await reportPdfData(o.orgId, catalogId))?.firmName, 'Eski brend');
  });

  it('a bank transfer: a paid "bank" order, the agreed amount, the same effects as a callback; a catalogue is paid once', async () => {
    const { orgId } = await org();
    const done = await recordTransfer({ orgId, planId: 'firm_yearly', catalogId: null, amount: 15_000_000 });
    assert.ok(done.ok);
    const paid = await db.order.findUniqueOrThrow({ where: { id: done.orderId } });
    assert.deepEqual([paid.status, paid.provider, paid.amount, paid.planId, paid.testMode], ['paid', 'bank', 15_000_000, 'firm_yearly', false]);
    assert.match(paid.orgName ?? '', /^test-/, 'the org name is kept on the order');
    assert.equal((await planStatus(orgId)).tier, 'firm');
    assert.deepEqual(await recordTransfer({ orgId, planId: 'nope', catalogId: null }), { ok: false, reason: 'unknown_plan' });

    const shop = await org();
    const actor = { ...(await makePerson(shop.orgId, 'admin')), orgId: shop.orgId };
    const { catalogId } = await makeCatalog(shop.orgId, [{ rawName: 'Sement', suggestedMxik: null, confidence: null }]);
    assert.deepEqual(await recordTransfer({ orgId: shop.orgId, planId: 'catalog_500', catalogId: null }), { ok: false, reason: 'catalog' });
    assert.deepEqual(await recordTransfer({ orgId: shop.orgId, planId: 'catalog_2000', catalogId }), { ok: false, reason: 'catalog' });
    const pending = await createOrder(actor, { planId: 'catalog_500', catalogId }, 'click');
    assert.equal(pending.ok, true);
    assert.equal((await recordTransfer({ orgId: shop.orgId, planId: 'catalog_500', catalogId })).ok, true);
    assert.equal(await catalogPaid(shop.orgId, catalogId), true);
    assert.equal((await planStatus(shop.orgId)).state, 'expired', 'a catalogue payment is not a subscription');
    // Paid once: no second order, and an order made before the payment can no longer be paid.
    assert.deepEqual(await createOrder(actor, { planId: 'catalog_500', catalogId }, 'payme'), { ok: false, reason: 'already_paid' });
    assert.deepEqual(await recordTransfer({ orgId: shop.orgId, planId: 'catalog_500', catalogId }), { ok: false, reason: 'already_paid' });
    assert.ok(pending.ok);
    assert.equal(await markPaid(pending.id, 'click'), 'already_paid');
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: pending.id } })).status, 'created');
  });
});

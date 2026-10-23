import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planLimits, TRIAL_DAYS } from './limits';
import { catalogPlan, firmPrice, planById, PLANS, subscriptionPlan, SUBSCRIPTION_IDS, tierOffers, TIERS, YEARLY_PAID_MONTHS } from './plans';

describe('plans', () => {
  it('names every subscription <tier>_<period>, monthly and yearly', () => {
    assert.deepEqual(SUBSCRIPTION_IDS, ['company_monthly', 'company_yearly', 'accountant_monthly', 'accountant_yearly', 'firm_monthly', 'firm_yearly']);
    for (const id of SUBSCRIPTION_IDS) assert.equal(planById(id)?.id, id);
  });

  it('prices: one table, cheapest tier first, a year at ten months', () => {
    assert.deepEqual(TIERS.map((t) => PLANS.tiers[t].monthly), [390_000, 900_000, 1_800_000]);
    assert.equal(YEARLY_PAID_MONTHS, 10);
    for (const t of TIERS) {
      const monthly = subscriptionPlan(t, 'monthly');
      const yearly = subscriptionPlan(t, 'yearly');
      assert.equal(yearly.price, monthly.price * 10);
      assert.ok(yearly.price < monthly.price * 12, 'a year is cheaper than twelve months');
      assert.equal(monthly.months, 1);
      assert.equal(yearly.months, 12);
      assert.equal(monthly.kind, 'subscription');
      assert.equal(monthly.tier, t);
    }
  });

  it('every price is a positive whole number of soʻm', () => {
    const prices = [...tierOffers().flatMap((o) => [o.monthly.price, o.yearly.price]), ...PLANS.catalog.map((c) => c.price)];
    for (const price of prices) assert.ok(Number.isSafeInteger(price) && price > 0, String(price));
  });

  it('keeps the ids of orders recorded before the tiers', () => {
    assert.deepEqual(planById('catalog_500'), { id: 'catalog_500', price: 700_000, kind: 'catalog', maxRows: 500 });
    assert.deepEqual(planById('catalog_2000'), { id: 'catalog_2000', price: 1_500_000, kind: 'catalog', maxRows: 2_000 });
    assert.deepEqual(planById('catalog_10000'), { id: 'catalog_10000', price: 4_000_000, kind: 'catalog', maxRows: 10_000 });
    // The single firm subscription is now the top tier, monthly, and the firm price is its price.
    assert.deepEqual(planById('firm_monthly'), { id: 'firm_monthly', price: 1_800_000, kind: 'subscription', maxRows: null, tier: 'firm', months: 1 });
    assert.equal(firmPrice(), 1_800_000);
    assert.equal(planById('nope'), null);
    assert.equal(planById(''), null);
  });

  it('a catalogue gets the smallest tier it fits; above the largest it is priced individually', () => {
    assert.equal(catalogPlan(1)?.id, 'catalog_500');
    assert.equal(catalogPlan(500)?.id, 'catalog_500');
    assert.equal(catalogPlan(501)?.id, 'catalog_2000');
    assert.equal(catalogPlan(10_000)?.id, 'catalog_10000');
    assert.equal(catalogPlan(10_001), null);
  });

  it('limits: the trial and each tier, from the same table; higher tiers never give less', () => {
    const limits = planLimits();
    assert.equal(TRIAL_DAYS, 14);
    assert.deepEqual(limits.trial, { clients: 3, rowsPerMonth: 5_000, seats: 2 });
    assert.deepEqual(limits.company, PLANS.tiers.company.limits);
    assert.deepEqual(limits.firm, PLANS.tiers.firm.limits);
    const atLeast = (a: number | null, b: number | null) => a === null || (b !== null && a >= b);
    for (let i = 1; i < TIERS.length; i++) {
      const [lo, hi] = [limits[TIERS[i - 1]!], limits[TIERS[i]!]];
      for (const key of ['clients', 'rowsPerMonth', 'seats'] as const) assert.ok(atLeast(hi[key], lo[key]), `${TIERS[i]} ${key}`);
    }
  });
});

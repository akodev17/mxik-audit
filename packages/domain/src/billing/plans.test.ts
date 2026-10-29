import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planLimits, TRIAL_DAYS } from './limits';
import { addMonths, creditDays, nextPeriod } from './period';
import { catalogPlan, firmPrice, planById, PLANS, subscriptionPlan, SUBSCRIPTION_IDS, tierOffers, TIERS, YEARLY_PAID_MONTHS } from './plans';

const DAY = 86_400_000;
const utc = (s: string): Date => new Date(`${s}T00:00:00Z`);

describe('subscription periods (pure)', () => {
  it('adds calendar months with the day clamped to the target month', () => {
    assert.deepEqual(addMonths(utc('2026-01-31'), 1), utc('2026-02-28'), 'not 3 March');
    assert.deepEqual(addMonths(utc('2028-01-31'), 1), utc('2028-02-29'), 'leap year');
    assert.deepEqual(addMonths(utc('2026-03-31'), 1), utc('2026-04-30'));
    assert.deepEqual(addMonths(utc('2026-12-31'), 2), utc('2027-02-28'), 'across the year end');
    assert.deepEqual(addMonths(utc('2026-01-15'), 12), utc('2027-01-15'));
    assert.deepEqual(addMonths(new Date('2026-05-10T13:45:00Z'), 1), new Date('2026-06-10T13:45:00Z'), 'the time of day is kept');
  });

  it('the tier rule: new, renew, upgrade with the price-ratio credit, refused downgrade, forced conversion', () => {
    const now = utc('2026-06-01');
    const company = subscriptionPlan('company', 'monthly');
    const firmYear = subscriptionPlan('firm', 'yearly');
    assert.deepEqual(nextPeriod(null, company, now), { ok: true, kind: 'new', until: utc('2026-07-01'), creditDays: 0 });
    // An ended subscription is the same as none: the period starts now.
    assert.deepEqual(nextPeriod({ tier: 'firm', until: utc('2026-05-01') }, company, now), { ok: true, kind: 'new', until: utc('2026-07-01'), creditDays: 0 });
    assert.deepEqual(nextPeriod({ tier: 'company', until: utc('2026-06-20') }, subscriptionPlan('company', 'yearly'), now), { ok: true, kind: 'renew', until: utc('2027-06-20'), creditDays: 0 });
    // 30 days of company (390 000) are 6 days of firm (1 800 000): floor(30 × 390 / 1800) = 6.
    assert.equal(creditDays(30 * DAY, 'company', 'firm'), 6);
    assert.deepEqual(nextPeriod({ tier: 'company', until: utc('2026-07-01') }, firmYear, now), { ok: true, kind: 'upgrade', until: new Date(utc('2027-06-01').getTime() + 6 * DAY), creditDays: 6 });
    assert.deepEqual(nextPeriod({ tier: 'firm', until: utc('2026-07-01') }, company, now), { ok: false, reason: 'plan_change' });
    assert.deepEqual(nextPeriod({ tier: 'accountant', until: utc('2026-07-01') }, company, now), { ok: false, reason: 'plan_change' });
    // floor(30 × 1800 / 390) = 138 days of company for 30 days of firm.
    assert.deepEqual(nextPeriod({ tier: 'firm', until: utc('2026-07-01') }, company, now, true), { ok: true, kind: 'forced', until: new Date(utc('2026-07-01').getTime() + 138 * DAY), creditDays: 138 });
  });
});

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

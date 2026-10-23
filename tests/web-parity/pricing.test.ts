// The landing page's pricing section shows PRICING (apps/web/src/components/landing/config.ts), a copy
// of PLANS in packages/domain/src/billing/plans.ts, which the app enforces and charges. A price or a
// limit changed on one side fails here until the other says the same.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apiConfig } from '@tasnivo/domain/api/limits';
import { planLimits, TRIAL_DAYS } from '@tasnivo/domain/billing/limits';
import { catalogPlan, FEATURES, PLAN_FEATURES, planById, PLANS, subscriptionPlan, TIERS, YEARLY_PAID_MONTHS } from '@tasnivo/domain/billing/plans';
import { PRICING } from '@/components/landing/config';

describe('landing pricing = domain plans', () => {
  it('shows the tiers in the domain\'s order, with the domain\'s monthly and yearly prices', () => {
    assert.deepEqual(PRICING.tiers.map((t) => t.tier), [...TIERS]);
    assert.equal(PRICING.yearlyPaidMonths, YEARLY_PAID_MONTHS);
    for (const t of PRICING.tiers) {
      assert.equal(t.monthly, subscriptionPlan(t.tier, 'monthly').price, `${t.tier} monthly`);
      assert.equal(t.monthly * PRICING.yearlyPaidMonths, subscriptionPlan(t.tier, 'yearly').price, `${t.tier} yearly`);
    }
  });

  it('promises the limits the app enforces: the trial and every tier', () => {
    const limits = planLimits();
    const checks = apiConfig({}).checksPerMonth;
    assert.equal(PRICING.trial.days, TRIAL_DAYS);
    assert.deepEqual({ ...PRICING.trial.limits }, limits.trial);
    assert.equal(PRICING.trial.apiChecks, checks.trial);
    for (const t of PRICING.tiers) {
      assert.deepEqual({ ...t.limits }, limits[t.tier], `${t.tier} limits`);
      assert.equal(t.apiChecks, checks[t.tier], `${t.tier} API checks`);
    }
  });

  it('marks each card\'s feature lines as the app enforces them, in the domain\'s order', () => {
    assert.deepEqual(PRICING.features.map(([key]) => key), [...FEATURES]);
    const columns = ['trial', ...TIERS] as const;
    for (const [key, marks] of PRICING.features) {
      assert.deepEqual([...marks], columns.map((plan) => PLAN_FEATURES[plan][key]), key);
    }
  });

  it('prices the one-off corrected catalogue as the checkout does', () => {
    assert.equal(PRICING.catalog.length, PLANS.catalog.length);
    for (const t of PRICING.catalog) {
      const plan = catalogPlan(t.maxRows);
      assert.equal(plan?.maxRows, t.maxRows);
      assert.equal(plan && planById(plan.id)?.price, t.price, `${t.maxRows} rows`);
    }
  });
});

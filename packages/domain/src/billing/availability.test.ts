import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogPurchase, purchaseOf } from './availability';
import { billingConfig } from './config';
import { catalogPlan, subscriptionPlan } from './plans';

const providers = billingConfig({ CLICK_SERVICE_ID: 's', CLICK_MERCHANT_ID: 'm', CLICK_SECRET_KEY: 'k' });
const none = billingConfig({});

describe('billing honesty', () => {
  it('without a plan nothing is for sale, whoever looks and whatever is configured', () => {
    assert.deepEqual(purchaseOf({ plan: null, config: providers, admin: true, demo: false }), { kind: 'not_for_sale' });
    assert.deepEqual(purchaseOf({ plan: null, config: none, admin: false, demo: false }), { kind: 'not_for_sale' });
  });

  it('a price without a payment provider says so instead of showing buttons', () => {
    assert.deepEqual(purchaseOf({ plan: subscriptionPlan('company', 'monthly'), config: none, admin: true, demo: false }), { kind: 'no_provider', price: 390_000 });
  });

  it('only an admin gets pay buttons', () => {
    const plan = subscriptionPlan('firm', 'yearly');
    assert.deepEqual(purchaseOf({ plan, config: providers, admin: false, demo: false }), { kind: 'admin_only', price: 18_000_000 });
    assert.deepEqual(purchaseOf({ plan, config: providers, admin: true, demo: false }), { kind: 'available', price: 18_000_000, providers: ['click'] });
  });

  it('a demo never pays', () => {
    assert.deepEqual(purchaseOf({ plan: subscriptionPlan('accountant', 'monthly'), config: providers, admin: true, demo: true }), { kind: 'demo' });
  });

  it('a catalogue: paid, too large, or the same rules as a subscription', () => {
    assert.deepEqual(catalogPurchase({ plan: catalogPlan(100), config: none, admin: true, demo: false, paid: true }), { kind: 'paid' });
    assert.deepEqual(catalogPurchase({ plan: catalogPlan(50_000), config: providers, admin: true, demo: false, paid: false }), { kind: 'too_large' });
    assert.equal(catalogPurchase({ plan: catalogPlan(100), config: none, admin: true, demo: false, paid: false }).kind, 'no_provider');
    assert.equal(catalogPurchase({ plan: catalogPlan(100), config: providers, admin: false, demo: false, paid: false }).kind, 'admin_only');
  });
});
